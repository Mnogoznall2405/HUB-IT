"""Concurrent listing load probe: N parallel GET /my-files, p50/p95 per wave."""
import http.client
import json
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HOST, PORT = '127.0.0.1', 18013
FOLDER_1000 = 'ba4e6ae1501e493fbea8037da36282e9'
FOLDER_100 = '9e941cbdb9324de59fb21dde3729e783'


def login():
    c = http.client.HTTPConnection(HOST, PORT, timeout=30)
    c.request('POST', '/api/v1/auth/login', body=json.dumps(
        {'username': 'e2e_admin', 'password': 'e2e-local-admin-pass'}),
        headers={'Content-Type': 'application/json'})
    r = c.getresponse()
    r.read()
    assert r.status == 200, r.status
    return '; '.join(v.split(';')[0] for k, v in r.getheaders() if k.lower() == 'set-cookie')


def one_request(cookie, path):
    t0 = time.perf_counter()
    c = http.client.HTTPConnection(HOST, PORT, timeout=60)
    c.request('GET', path, headers={'Cookie': cookie})
    r = c.getresponse()
    r.read()
    dt = (time.perf_counter() - t0) * 1000
    return dt, r.status


def wave(cookie, path, concurrency, per_user=3):
    """Fire `concurrency` workers; each runs per_user sequential requests."""
    results = []
    lock = threading.Lock()

    def work(_i):
        for _ in range(per_user):
            dt, status = one_request(cookie, path)
            with lock:
                results.append((dt, status))

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(work, range(concurrency)))
    wall = (time.perf_counter() - t0) * 1000
    times = sorted(dt for dt, _ in results)
    errors = [s for _, s in results if s != 200]
    p50 = times[len(times) // 2]
    p95 = times[int(len(times) * 0.95) - 1]
    print(
        f'users={concurrency:3} reqs={len(results):4} wall={wall:6.0f}ms '
        f'p50={p50:6.1f}ms p95={p95:6.1f}ms max={times[-1]:7.1f}ms errors={len(errors)}'
    )


cookie = login()
path = f'/api/v1/my-files?folder_id={FOLDER_100}'
print('warm-up')
wave(cookie, path, 1, per_user=5)
print('--- f100 folder listing ---')
for c in [1, 5, 10, 20, 50, 100]:
    wave(cookie, path, c, per_user=3)
print('--- f1000 folder listing ---')
path = f'/api/v1/my-files?folder_id={FOLDER_1000}'
for c in [1, 5, 10, 20, 50, 100]:
    wave(cookie, path, c, per_user=3)
