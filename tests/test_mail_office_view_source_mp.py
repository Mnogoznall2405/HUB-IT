"""Real multi-process tests for the shared office-view source store.

Each worker runs as a separate ``sys.executable`` interpreter with its own
``OfficeViewSourceStore`` instance — the same failure surface as two PM2
backend processes sharing the spool directory.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

WORKER = r"""
import os, sys, time
sys.path.insert(0, r"{web}")
from pathlib import Path
from backend.services.mail_office_view_source_store import (
    OfficeViewSourceStore, _InterProcessLock,
)
root, action, key = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
store = OfficeViewSourceStore(root=root)
if action == "put":
    size, ttl, seed = int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
    ok = store.put(key, filename="f.bin", content_type="application/octet-stream",
                   content=(seed.encode() * size)[:size], ttl_sec=ttl)
    print("PUT", "OK" if ok else "REJECTED")
elif action == "get":
    e = store.get(key)
    print("GET", "MISS" if e is None else (len(e.content), e.content[:1].decode()))
elif action == "hold-lock":
    with _InterProcessLock(root / ".mvsrc.lock", 5):
        print("LOCKED", flush=True)
        time.sleep(float(sys.argv[4]))
elif action == "crash-mid-write":
    store._write_atomic(root / (key + ".orphan.bin"), b"dead")
    os._exit(0)
"""


def _worker(root: Path, action: str, key: str, *args, env_extra: dict | None = None,
            wait: bool = True) -> subprocess.Popen | str:
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **(env_extra or {})}
    proc = subprocess.Popen(
        [sys.executable, "-c", WORKER.format(web=str(WEB_ROOT)), str(root), action, key, *map(str, args)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    if not wait:
        return proc
    out, err = proc.communicate(timeout=60)
    assert proc.returncode == 0, f"worker failed: {err}"
    return out.strip()


def _dir_state(root: Path) -> tuple[int, int]:
    metas = list(root.glob("*.json"))
    bins = list(root.glob("*.bin"))
    return len(metas), len(bins)


def _total_bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in root.glob("*.bin"))


def test_process_a_writes_process_b_reads(tmp_path):
    _worker(tmp_path, "put", "k1", 4096, 600, "A")
    out = _worker(tmp_path, "get", "k1")
    assert "(4096, 'A')" in out
    assert _dir_state(tmp_path) == (1, 1)


def test_two_processes_put_different_keys_in_parallel(tmp_path):
    procs = [
        _worker(tmp_path, "put", "ka", 8192, 600, "A", wait=False),
        _worker(tmp_path, "put", "kb", 8192, 600, "B", wait=False),
    ]
    for p in procs:
        out, err = p.communicate(timeout=60)
        assert p.returncode == 0 and "PUT OK" in out, err
    assert _dir_state(tmp_path) == (2, 2)
    assert "'A'" in _worker(tmp_path, "get", "ka") and "'B'" in _worker(tmp_path, "get", "kb")


def test_two_processes_put_same_key_never_torn(tmp_path):
    procs = [
        _worker(tmp_path, "put", "same", 8192, 600, "A", wait=False),
        _worker(tmp_path, "put", "same", 8192, 600, "B", wait=False),
    ]
    for p in procs:
        out, _ = p.communicate(timeout=60)
        assert "PUT OK" in out
    n_meta, n_bin = _dir_state(tmp_path)
    assert n_meta == 1
    meta = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert Path(meta["payload"]).suffix == ".bin" and (tmp_path / meta["payload"]).is_file()
    content = (tmp_path / meta["payload"]).read_bytes()
    assert content in (b"A" * 8192, b"B" * 8192)  # one complete version, never a mix


def test_orphan_payload_from_crash_is_swept_with_grace(tmp_path):
    _worker(tmp_path, "crash-mid-write", "k1")
    orphan = tmp_path / "k1.orphan.bin"
    assert orphan.is_file()
    # Fresh orphan survives a sweep (protects in-flight writes of live processes).
    _worker(tmp_path, "put", "k2", 128, 600, "Z")
    assert orphan.is_file(), "grace period must protect young unreferenced payloads"
    # Aged past the grace period → next sweep removes it.
    old = time.time() - 3600
    os.utime(orphan, (old, old))
    _worker(tmp_path, "put", "k3", 128, 600, "Z")
    assert not orphan.exists()
    assert _dir_state(tmp_path) == (2, 2)


def test_concurrent_puts_respect_total_byte_cap(tmp_path):
    env = {"MAIL_OFFICE_VIEW_SOURCE_MAX_BYTES": str(3 * 8192)}
    procs = [
        _worker(tmp_path, "put", f"k{i}", 8192, 600, "X", env_extra=env, wait=False)
        for i in range(4)
    ]
    for p in procs:
        p.communicate(timeout=60)
        assert p.returncode == 0
    assert _total_bytes(tmp_path) <= 3 * 8192
    n_meta, n_bin = _dir_state(tmp_path)
    assert n_meta <= 3 and n_bin <= n_meta


def test_reader_during_eviction_gets_whole_entry_or_miss(tmp_path):
    env = {"MAIL_OFFICE_VIEW_SOURCE_MAX_BYTES": str(3 * 8192)}
    _worker(tmp_path, "put", "victim", 8192, 30, "V", env_extra=env)  # short ttl → evicted first
    _worker(tmp_path, "put", "keep1", 8192, 600, "K", env_extra=env)
    results = []
    for _ in range(6):
        # Interleave reads with puts that force eviction of "victim".
        _worker(tmp_path, "put", "keep2", 8192, 600, "K", env_extra=env)
        out = _worker(tmp_path, "get", "victim")
        results.append(out)
        _worker(tmp_path, "put", "keep3", 8192, 600, "K", env_extra=env)
    assert all("MISS" in r or "(8192, 'V')" in r for r in results), results
    assert any("(8192, 'V')" in r for r in results)  # entry lived until evicted
    assert "MISS" in results[-1]


def test_lock_timeout_returns_cleanly_under_contention(tmp_path):
    holder = _worker(tmp_path, "hold-lock", "x", 4, wait=False)
    line = holder.stdout.readline().strip()
    assert line == "LOCKED"
    # Writer waits at most 1s for the lock → bounded failure, not a hang.
    env = {"MAIL_OFFICE_VIEW_SOURCE_LOCK_TIMEOUT_SEC": "1"}
    proc = _worker(tmp_path, "put", "k1", 64, 600, "L", env_extra=env, wait=False)
    _out, err = proc.communicate(timeout=30)
    assert proc.returncode != 0 and "LockTimeout" in err
    holder.communicate(timeout=30)


def test_valid_entry_survives_writer_process_exit(tmp_path):
    # Writer process fully exits (process death); a later reader still serves.
    _worker(tmp_path, "put", "k9", 2048, 600, "R")
    assert _worker(tmp_path, "get", "k9") != "GET MISS"
    assert "(2048, 'R')" in _worker(tmp_path, "get", "k9")
