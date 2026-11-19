# -*- coding: utf-8 -*-
"""Classify online agents: user-not-logged-in vs dead-probe."""
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
env = dotenv_values(r"C:\Project\HUB-IT-main\.env")
scan = create_engine(env["SCAN_DATABASE_URL"])
app = create_engine(env["APP_DATABASE_URL"])

with scan.connect() as c:
    agents = {r["agent_id"]: dict(r) for r in c.execute(text("""
        SELECT agent_id, version, status, to_timestamp(last_seen_at) seen
        FROM scan.scan_agents
        WHERE status='online'
          AND last_seen_at > extract(epoch from now() - interval '15 min')
    """)).mappings()}
    pending = {r[0] for r in c.execute(text("""
        SELECT agent_id FROM scan.scan_tasks
        WHERE dedupe_key='probe-revive-20261116'
          AND status IN ('queued','delivered','acknowledged')
    """))}
    failed = {r[0] for r in c.execute(text("""
        SELECT agent_id FROM scan.scan_tasks
        WHERE dedupe_key='probe-revive-20261116' AND status='failed'
    """))}

with app.connect() as c:
    buckets60 = {r[0] for r in c.execute(text("""
        SELECT DISTINCT lower(computer_name) FROM app.dlp_activity_buckets
        WHERE updated_at > now() - interval '60 min'"""))}
    buckets24 = {r[0] for r in c.execute(text("""
        SELECT DISTINCT lower(computer_name) FROM app.dlp_activity_buckets
        WHERE updated_at > now() - interval '24 h'"""))}
    files24 = {r[0] for r in c.execute(text("""
        SELECT DISTINCT lower(computer_name) FROM app.file_left_events
        WHERE created_at > now() - interval '24 h'"""))}
    visits24 = {r[0] for r in c.execute(text("""
        SELECT DISTINCT lower(computer_name) FROM app.browser_probe_visits
        WHERE created_at > now() - interval '24 h'"""))}

groups = {"ok": [], "dead_probe_pending": [], "dead_probe_restart_pending": [],
          "probably_no_user": [], "failed": []}
for aid in sorted(agents):
    low = aid.lower()
    if low in buckets60:
        groups["ok"].append(aid)
    elif aid in failed:
        groups["failed"].append(aid)
    elif aid in pending:
        groups["dead_probe_pending"].append(aid)
    elif low in files24 or low in visits24 or low in buckets24:
        groups["dead_probe_restart_pending"].append(aid)  # user worked today, no buckets now
    else:
        groups["probably_no_user"].append(aid)            # online but zero user signals

print(f"online agents: {len(agents)}")
print(f"[ok] buckets flowing: {len(groups['ok'])}")
print(f"[pending] revive task in-flight: {len(groups['dead_probe_pending'])}")
print(f"[still silent, user signals exist] (restart pending/lagon needed): {len(groups['dead_probe_restart_pending'])}")
for h in groups["dead_probe_restart_pending"]:
    print("   -", h)
print(f"[failed] revive failed: {len(groups['failed'])}")
for h in groups["failed"]:
    print("   -", h)
print(f"[probably nobody logged in] (online, zero user signals 24h): {len(groups['probably_no_user'])}")
for h in groups["probably_no_user"]:
    print("   -", h)
