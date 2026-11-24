"""A7 harness: real AI requests through the production chat API (serial, 1-at-a-time)."""
import json, os, sys, time, uuid, io

ROOT = r"C:\Project\Image_scan\WEB-itinvent"
sys.path.insert(0, ROOT)
os.chdir(ROOT)
from dotenv import load_dotenv
load_dotenv(r"C:\Project\HUB-IT-main\.env")

import requests
from backend.services.session_service import session_service
from backend.utils.security import create_access_token
import psycopg

BASE = "http://127.0.0.1:8002"
TEST_USER_ID = 36
OUT = r"C:\Project\Image_scan\.codex_tmp\a7_results.jsonl"
CID = "4d7a22a0-ec30-4391-95a7-41f156ea4d28"

def _db():
    url = os.environ['APP_DATABASE_URL']
    for p in ('postgresql+psycopg://', 'postgresql+psycopg2://'):
        url = url.replace(p, 'postgresql://')
    return psycopg.connect(url)

def make_token():
    sid = uuid.uuid4().hex
    session_service.create_session(
        session_id=sid, user_id=TEST_USER_ID, username="test1",
        role="viewer", ip_address="127.0.0.1", user_agent="a7-harness",
        expires_at="2030-01-01T00:00:00+00:00")
    return create_access_token({"sub": "test1", "user_id": TEST_USER_ID,
        "role": "viewer", "session_id": sid, "device_id": "a7-harness"})

def _refresh():
    global TOKEN, H
    TOKEN = make_token()
    H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

_refresh()

def api(method, path, **kw):
    r = requests.request(method, BASE + path, headers=H, timeout=60, **kw)
    if r.status_code == 401:
        _refresh()
        r = requests.request(method, BASE + path, headers=H, timeout=60, **kw)
    return r

def bot_message_ids(cid):
    r = api("GET", f"/api/v1/chat/conversations/{cid}/messages?limit=30")
    if r.status_code != 200:
        return set(), {}
    out, bodies = set(), {}
    for m in r.json().get("items") or []:
        sid = (m.get("sender") or {}).get("id")
        if sid and int(sid) != TEST_USER_ID:
            out.add(m["id"]); bodies[m["id"]] = str(m.get("body") or "")[:600]
    return out, bodies

def run_for_message(msg_id):
    try:
        with _db() as con:
            cur = con.execute(
                "select id, status, created_at, started_at, completed_at, error_text "
                "from app.ai_bot_runs where trigger_message_id=%s", (msg_id,))
            r = cur.fetchone()
            if r:
                return {"run_id": str(r[0]), "run_status": r[1],
                        "run_created_at": str(r[2]), "run_started_at": str(r[3]),
                        "run_completed_at": str(r[4]), "run_error": r[5]}
    except Exception as e:
        return {"run_db_error": str(e)[:200]}
    return {}

def send_and_wait(cid, text, *, timeout=120):
    before, _ = bot_message_ids(cid)
    t0 = time.perf_counter()
    r = api("POST", f"/api/v1/chat/conversations/{cid}/messages",
            json={"body": text, "body_format": "plain", "client_message_id": uuid.uuid4().hex})
    t_send = time.perf_counter() - t0
    res = {"text": text, "send_status": r.status_code, "send_ms": round(t_send * 1000, 1)}
    if r.status_code != 200:
        res["error"] = r.text[:300]; return res
    res["msg_id"] = r.json().get("id")
    t_reply, reply = None, None
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        time.sleep(0.8)
        now, bodies = bot_message_ids(cid)
        new = now - before
        if new:
            t_reply = time.perf_counter() - t0
            reply = bodies.get(next(iter(new)))
            break
    res["reply_ms"] = round(t_reply * 1000, 1) if t_reply else None
    res["reply_body"] = reply
    time.sleep(0.5)
    res.update(run_for_message(res["msg_id"]) or {})
    return res

if __name__ == "__main__":
    cid = os.environ.get("A7_CID", CID)
    start = int(os.environ.get("A7_START", "0"))
    n = int(os.environ.get("A7_N", "5"))
    reqs = json.load(open(r"C:\Project\Image_scan\.codex_tmp\a7_requests.json", encoding="utf-8"))
    batch = reqs[start:start + n]
    with io.open(OUT, "a", encoding="utf-8") as f:
        for i, item in enumerate(batch):
            t = item["text"]
            if not t.strip():
                continue  # skip empty-body edge cases for now (422 vs UI blocks)
            res = send_and_wait(cid, t)
            res["expected"] = item.get("expected")
            res["idx"] = start + i
            f.write(json.dumps(res, ensure_ascii=False) + "\n"); f.flush()
            print(f"[{start+i}] exp={item.get('expected')} send={res['send_ms']}ms "
                  f"reply={res.get('reply_ms')}ms run={res.get('run_id','-')[:8]}", flush=True)
    print("DONE")
