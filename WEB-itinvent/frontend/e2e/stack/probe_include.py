"""One-shot probe: include=tree,quota merge + ETag/304 on the V3 stand."""
import http.cookiejar
import json
import time
import urllib.request

BASE = "http://localhost:18013"
CJ = http.cookiejar.CookieJar()
# No ProxyHandler: urllib's WPAD lookup costs ~2s per request on this host.
OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    urllib.request.HTTPCookieProcessor(CJ),
)


def req(path, headers=None, method="GET", body=None):
    r = urllib.request.Request(BASE + path, method=method, data=body)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        resp = OPENER.open(r, timeout=30)
        return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def main():
    body = json.dumps({"username": "e2e_admin", "password": "e2e-local-admin-pass"}).encode()
    s, h, b = req("/api/v1/auth/login", headers={"Content-Type": "application/json"}, method="POST", body=body)
    print("login", s)

    etag = None
    for label, path in [("plain", "/api/v1/my-files"), ("merged", "/api/v1/my-files?include=tree,quota")]:
        t0 = time.perf_counter()
        s, h, b = req(path)
        ms = (time.perf_counter() - t0) * 1000
        d = json.loads(b)
        items = len(d.get("items", []))
        tree = len(d.get("tree_folders", []))
        quota = d.get("quota")
        print("%s: %s %.0fms items=%s tree=%s quota=%s etag=%s" % (label, s, ms, items, tree, quota, h.get("ETag")))
        if label == "merged":
            etag = h.get("ETag")

    if etag:
        t0 = time.perf_counter()
        s, h, b = req("/api/v1/my-files?include=tree,quota", headers={"If-None-Match": etag})
        print("conditional: %s %.0fms body=%db" % (s, (time.perf_counter() - t0) * 1000, len(b)))

    for p in ["/api/v1/my-files/folders", "/api/v1/my-files/quota"]:
        t0 = time.perf_counter()
        s, h, b = req(p)
        print("%s: %s %.0fms bytes=%d" % (p, s, (time.perf_counter() - t0) * 1000, len(b)))


if __name__ == "__main__":
    main()
