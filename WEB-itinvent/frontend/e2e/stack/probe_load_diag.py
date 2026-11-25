"""Load diagnosis probe: concurrent listing waves with full error evidence.

For each concurrency level C in --levels, C independent workers each send
--per-user sequential GET requests to the listing endpoint. Every outcome is
recorded: HTTP status, exception class + errno, wall time, per-request timing.
Unlike probe_load.py, each worker keeps ONE persistent connection (re-opened
on failure), so app-level failures are separated from TCP-churn artefacts.

Multi-user mode (USERS>1): N load users are created via the admin API
(load_user_NN / role viewer) and each logs in once; workers are assigned
cookies round-robin, so concurrency reflects independent sessions, not one
shared session.

Usage: python probe_load_diag.py [port] [levels] [folder] [users]
  port   default 18013
  levels default "1,5,10,20,50,100"
  folder default FOLDER_1000 id
  users  default 1 (shared admin session); e.g. 40 = independent users
"""
import http.client
import json
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HOST = '127.0.0.1'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18013
LEVELS = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else '1,5,10,20,50,100').split(',')]
FOLDER = sys.argv[3] if len(sys.argv) > 3 else 'ba4e6ae1501e493fbea8037da36282e9'
USERS = int(sys.argv[4]) if len(sys.argv) > 4 else 1
PER_USER = 3
LIB = sys.argv[5] if len(sys.argv) > 5 else ''
LIB_Q = f'&library_id={LIB}' if LIB else ''
PATH = f'/api/v1/my-files?folder_id={FOLDER}&limit=150&sort=name&order=asc{LIB_Q}'


def api(method, path, body=None, cookie=''):
    c = http.client.HTTPConnection(HOST, PORT, timeout=60)
    hdrs = {'Content-Type': 'application/json'}
    if cookie:
        hdrs['Cookie'] = cookie
    c.request(method, path, body=json.dumps(body) if body is not None else None, headers=hdrs)
    r = c.getresponse()
    data = r.read()
    cookies = [v.split(';')[0] for k, v in r.getheaders() if k.lower() == 'set-cookie']
    return r.status, '; '.join(cookies), data


def login(username, password):
    s, cookies, data = api('POST', '/api/v1/auth/login', {'username': username, 'password': password})
    assert s == 200, (s, data[:200])
    return cookies


def ensure_users(admin_cookie, count):
    cookies = [admin_cookie]
    for i in range(1, count + 1):
        name = f'load_user_{i:03d}'
        s, _, data = api('POST', '/api/v1/auth/users', {
            'username': name, 'password': 'load-pass-1',
            'full_name': f'Load {i}', 'role': 'viewer',
            'auth_source': 'local', 'is_active': True,
        }, cookie=admin_cookie)
        if s not in (200, 201, 409):
            print(f'  user {name}: create -> {s} {data[:100]!r}')
        cookies.append(login(name, 'load-pass-1'))
    return cookies


def worker(cookie, results):
    """One persistent connection; reconnect once after a failure."""
    conn = http.client.HTTPConnection(HOST, PORT, timeout=60)
    for _ in range(PER_USER):
        t0 = time.perf_counter()
        try:
            conn.request('GET', PATH, headers={'Cookie': cookie})
            r = conn.getresponse()
            body = r.read()
            dt = (time.perf_counter() - t0) * 1000
            results.append(('ok', r.status, dt, len(body), ''))
        except Exception as exc:  # noqa: BLE001 - evidence is the point
            dt = (time.perf_counter() - t0) * 1000
            etype = type(exc).__name__
            errno = getattr(exc, 'errno', '') or (exc.args[0] if exc.args else '')
            results.append(('err', etype, dt, 0, str(errno)[:80]))
            try:
                conn.close()
            except Exception:
                pass
            conn = http.client.HTTPConnection(HOST, PORT, timeout=60)
    try:
        conn.close()
    except Exception:
        pass


def wave(cookies, concurrency):
    results = []
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(lambda i: worker(cookies[i % len(cookies)], results), range(concurrency)))
    wall = (time.perf_counter() - t0) * 1000
    oks = [r for r in results if r[0] == 'ok']
    errs = [r for r in results if r[0] == 'err']
    statuses = Counter(r[1] for r in oks)
    etypes = Counter(f'{r[1]}:{r[4]}' for r in errs)
    ts = sorted(r[2] for r in oks)
    p50 = ts[len(ts) // 2] if ts else -1
    p95 = ts[int(len(ts) * 0.95)] if ts else -1
    fastest_err = min((r[2] for r in errs), default=-1)
    print(f'C={concurrency:3d} wall={wall:6.0f}ms n={len(results)} '
          f'ok={len(oks)} p50={p50:5.0f} p95={p95:5.0f} '
          f'status={dict(statuses)} err={dict(etypes)} err_min={fastest_err:.0f}ms', flush=True)
    return results


def main():
    admin = login('e2e_admin', 'e2e-local-admin-pass')
    if USERS > 1:
        print(f'creating/logging {USERS} independent users...', flush=True)
        t0 = time.perf_counter()
        cookies = ensure_users(admin, USERS)
        print(f'  {len(cookies)} sessions ready in {(time.perf_counter() - t0):.0f}s', flush=True)
    else:
        cookies = [admin]
    print(f'load-diag port={PORT} folder={FOLDER} users={len(cookies)} path={PATH}')
    wave(cookies, 1)
    for c in LEVELS:
        wave(cookies, c)
        time.sleep(1.0)


if __name__ == '__main__':
    main()
