import http.client
import json
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18013


def req(method, path, body=None, cookie=None):
    c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=60)
    hdrs = {'Content-Type': 'application/json'}
    if cookie:
        hdrs['Cookie'] = cookie
    c.request(method, path, body=json.dumps(body) if body else None, headers=hdrs)
    r = c.getresponse()
    data = r.read()
    cookies = [v.split(';')[0] for k, v in r.getheaders() if k.lower() == 'set-cookie']
    return r.status, '; '.join(cookies), data


s, cookie, _ = req('POST', '/api/v1/auth/login', {'username': 'e2e_admin', 'password': 'e2e-local-admin-pass'})
print('login', s)
for label, path in [
    ('f10', '/api/v1/my-files?folder_id=c8ce7d9b01a4407da945ef8948a7fdb7'),
    ('f100', '/api/v1/my-files?folder_id=9e941cbdb9324de59fb21dde3729e783'),
    ('f500', '/api/v1/my-files?folder_id=006e82085d6e420482391629b9be203a'),
    ('f1000', '/api/v1/my-files?folder_id=ba4e6ae1501e493fbea8037da36282e9'),
    ('f1000+p1', '/api/v1/my-files?folder_id=ba4e6ae1501e493fbea8037da36282e9&limit=150&sort=name&order=asc'),
    ('f1000+inc', '/api/v1/my-files?folder_id=ba4e6ae1501e493fbea8037da36282e9&include=tree,quota'),
    ('search', '/api/v1/my-files?q=zebra'),
    ('quota', '/api/v1/my-files/quota'),
]:
    ts = []
    size = 0
    status = 0
    items = -1
    for _ in range(5):
        t0 = time.perf_counter()
        status, _, b = req('GET', path, cookie=cookie)
        ts.append((time.perf_counter() - t0) * 1000)
        size = len(b)
    try:
        items = len(json.loads(b).get('items', []))
    except Exception:
        pass
    ts.sort()
    print(f'{label:12} status={status} p50={ts[2]:.0f}ms min={ts[0]:.0f} max={ts[-1]:.0f} size={size // 1024}KB items={items}')
