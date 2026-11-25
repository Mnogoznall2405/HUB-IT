"""ETag / 304 verification on the V3 stand (http.client — no proxy quirks)."""
import http.client
import json
import time
import urllib.request


def login_cookies():
    req = urllib.request.Request(
        "http://localhost:18013/api/v1/auth/login", method="POST",
        data=json.dumps({"username": "e2e_admin", "password": "e2e-local-admin-pass"}).encode(),
        headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    resp = opener.open(req, timeout=30)
    cookies = "; ".join(c.split(";")[0] for c in (resp.headers.get_all("set-cookie") or []))
    resp.read()
    return cookies


def get(path, cookies, extra=None):
    t0 = time.perf_counter()
    c = http.client.HTTPConnection("127.0.0.1", 18013, timeout=20)
    hd = {"Cookie": cookies}
    hd.update(extra or {})
    c.request("GET", path, headers=hd)
    r = c.getresponse()
    body = r.read()
    ms = (time.perf_counter() - t0) * 1000
    c.close()
    return r.status, r.getheader("ETag"), len(body), ms


def main():
    cookies = login_cookies()
    s, e, n, ms = get("/api/v1/my-files?include=tree,quota", cookies)
    print("first ", s, e, n, "%.0fms" % ms)
    s, e2, n, ms = get("/api/v1/my-files?include=tree,quota", cookies, {"If-None-Match": e})
    print("match ", s, e2, n, "%.0fms" % ms)
    s, e2, n, ms = get("/api/v1/my-files?include=tree,quota", cookies, {"If-None-Match": '"%s"' % e})
    print("quoted", s, e2, n, "%.0fms" % ms)
    s, e2, n, ms = get("/api/v1/my-files?include=tree,quota", cookies, {"If-None-Match": "W/\"%s\"" % e})
    print("weak  ", s, e2, n, "%.0fms" % ms)
    s, e2, n, ms = get("/api/v1/my-files?include=tree,quota", cookies, {"If-None-Match": "deadbeef"})
    print("miss  ", s, e2, n, "%.0fms" % ms)
    s, e2, n, ms = get("/api/v1/my-files?view=shared&include=tree,quota", cookies)
    print("shared", s, "etag=", e2, n, "%.0fms" % ms)


if __name__ == "__main__":
    main()
