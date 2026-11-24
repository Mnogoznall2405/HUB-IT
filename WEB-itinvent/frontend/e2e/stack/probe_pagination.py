"""Live pagination probe: keyset pages, server sort/filter, total, ETag."""
import http.client
import json
import time

HOST, PORT = '127.0.0.1', 18013
FOLDER_1000 = 'ba4e6ae1501e493fbea8037da36282e9'


def login():
    c = http.client.HTTPConnection(HOST, PORT, timeout=30)
    c.request('POST', '/api/v1/auth/login', body=json.dumps(
        {'username': 'e2e_admin', 'password': 'e2e-local-admin-pass'}),
        headers={'Content-Type': 'application/json'})
    r = c.getresponse()
    r.read()
    assert r.status == 200, r.status
    return '; '.join(v.split(';')[0] for k, v in r.getheaders() if k.lower() == 'set-cookie')


def get(cookie, path):
    t0 = time.perf_counter()
    c = http.client.HTTPConnection(HOST, PORT, timeout=60)
    c.request('GET', path, headers={'Cookie': cookie})
    r = c.getresponse()
    body = r.read()
    dt = (time.perf_counter() - t0) * 1000
    etag = r.getheader('ETag') or ''
    return dt, r.status, json.loads(body) if body else {}, etag


def main():
    cookie = login()
    base = f'/api/v1/my-files?folder_id={FOLDER_1000}'

    # Page 1 with limit+sort
    dt, st, p1, etag1 = get(cookie, f'{base}&limit=150&sort=name&order=asc')
    items1 = p1.get('items', [])
    cur = p1.get('next_cursor') or ''
    print(f'page1: {dt:.0f}ms status={st} items={len(items1)} total={p1.get("total")} cursor={cur[:24]}… etag={etag1[:24]}…')
    names1 = [i['original_file_name'] for i in items1]
    assert len(items1) == 150 and p1.get('total') == 1000 and cur, 'page-1 contract broken'
    assert names1 == sorted(names1, key=str.lower), 'name asc not honoured'

    # Page 2 — disjoint ids, continues the name order
    dt, st, p2, _ = get(cookie, f'{base}&limit=150&sort=name&order=asc&cursor={cur}')
    items2 = p2.get('items', [])
    ids1 = {i['id'] for i in items1}
    overlap = ids1 & {i['id'] for i in items2}
    print(f'page2: {dt:.0f}ms status={st} items={len(items2)} overlap={len(overlap)} total={p2.get("total")}')
    assert len(items2) == 150 and not overlap, 'page-2 overlaps page-1'

    # Sort by size desc — check order + different cursor sort bound
    dt, st, ps, _ = get(cookie, f'{base}&limit=150&sort=size&order=desc')
    sizes = [i['original_size_bytes'] for i in ps.get('items', [])]
    print(f'size-desc: {dt:.0f}ms items={len(sizes)} first={sizes[0]} last={sizes[-1]}')
    assert sizes == sorted(sizes, reverse=True), 'size desc not honoured'

    # type_filter=sheet (csv = i%5==2 → 200 of 1000 rows)
    dt, st, pt, _ = get(cookie, f'{base}&limit=150&type_filter=sheet')
    sheet_items = pt.get('items', [])
    print(f'type=sheet: {dt:.0f}ms items={len(sheet_items)} total={pt.get("total")}')
    assert pt.get('total') == 200, f'expected 200 sheet rows, got {pt.get("total")}'
    assert all(i['original_file_name'].endswith('.csv') for i in sheet_items), 'type filter leaked non-sheet rows'

    # date_filter=30d — seed rows are fresh, expect all 1000
    dt, st, pd_, _ = get(cookie, f'{base}&limit=150&date_filter=30d')
    print(f'date=30d: {dt:.0f}ms total={pd_.get("total")}')
    assert pd_.get('total') == 1000

    # Unpaginated legacy contract — no limit => all rows, no cursor
    dt, st, pl, _ = get(cookie, base)
    print(f'legacy: {dt:.0f}ms items={len(pl.get("items", []))} total={pl.get("total")} cursor={pl.get("next_cursor")}')
    assert len(pl.get('items', [])) == 1000 and not pl.get('next_cursor')

    # ETag revalidation on a paginated listing
    c = http.client.HTTPConnection(HOST, PORT, timeout=30)
    c.request('GET', f'{base}&limit=150&sort=name&order=asc',
              headers={'Cookie': cookie, 'If-None-Match': etag1})
    r = c.getresponse()
    r.read()
    print(f'revalidate: status={r.status} (expect 304)')
    assert r.status == 304

    # Cursor bound to a different sort falls back to page-1 semantics
    dt, st, pm, _ = get(cookie, f'{base}&limit=150&sort=size&order=desc&cursor={cur}')
    first = pm.get('items', [{}])[0]
    print(f'mismatched-cursor: {dt:.0f}ms status={st} first_size={first.get("original_size_bytes")}')
    assert st == 200
    print('PAGINATION PROBE OK')


if __name__ == '__main__':
    main()
