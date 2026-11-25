"""Timing probe for my-files endpoints on the V3 stand (http.client, no proxy)."""
import http.client
import json
import statistics
import sys
import time
import urllib.request

BASE = ("127.0.0.1", 18013)
SEED = json.loads(
    open("e2e/artifacts/perf-audit/seed-v3.json", encoding="utf8").read())


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


def timed(path, cookies, extra=None, n=7):
    samples = []
    status = 0
    size = 0
    for _ in range(n):
        c = http.client.HTTPConnection(*BASE, timeout=30)
        hd = {"Cookie": cookies}
        hd.update(extra or {})
        t0 = time.perf_counter()
        c.request("GET", path, headers=hd)
        r = c.getresponse()
        body = r.read()
        samples.append((time.perf_counter() - t0) * 1000)
        status = r.status
        size = len(body)
        etag = r.getheader("ETag")
        c.close()
    return status, size, etag, samples


def report(label, path, cookies, extra=None, n=7):
    status, size, etag, samples = timed(path, cookies, extra, n)
    p50 = statistics.median(samples)
    p95 = sorted(samples)[int(len(samples) * 0.95) - 1]
    print("%-28s %s p50=%5.0fms p95=%5.0fms max=%5.0fms bytes=%d etag=%s"
          % (label, status, p50, p95, max(samples), size, etag))
    return p50


def main():
    cookies = login_cookies()
    tf = SEED["tableFolders"]
    report("root_listing", "/api/v1/my-files", cookies)
    report("root_merged", "/api/v1/my-files?include=tree,quota", cookies)
    for n in [10, 100, 500, 1000, 5000, 10000]:
        report("folder_%d" % n, "/api/v1/my-files?folder_id=" + tf[str(n)], cookies)
    report("folder_1000_merged", "/api/v1/my-files?folder_id=" + tf["1000"] + "&include=tree,quota", cookies)
    report("search_zebra", "/api/v1/my-files?q=zebra", cookies)
    report("search_perf", "/api/v1/my-files?q=perf-10000", cookies)
    report("quota", "/api/v1/my-files/quota", cookies)
    report("folders", "/api/v1/my-files/folders", cookies)
    report("library", "/api/v1/my-files?library_id=" + SEED["libraries"]["a"], cookies)
    report("lib_deep", "/api/v1/my-files?folder_id=" + SEED["libDeepFolderId"], cookies)
    report("recent", "/api/v1/my-files?view=recent", cookies)
    report("favorites", "/api/v1/my-files?view=favorites", cookies)
    report("trash", "/api/v1/my-files?view=trash", cookies)


if __name__ == "__main__":
    main()
