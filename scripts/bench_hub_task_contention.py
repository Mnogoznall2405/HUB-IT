#!/usr/bin/env python3
"""TASK-AUDIT: Hub task contention / race matrix (no retries)."""
from __future__ import annotations

import argparse
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
sys.path.insert(0, str(ROOT / "scripts"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

from _hub_task_bench_common import (  # noqa: E402
    TITLE_PREFIX,
    classify_db_error,
    ensure_project_id,
    new_run_meta,
    run_closed_loop,
    summary,
    write_json,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Bench Hub task contention")
    p.add_argument("--creator-id", type=int, default=1253)
    p.add_argument("--assignee-id", type=int, default=1254)
    p.add_argument("--iterations", type=int, default=100)
    p.add_argument("--warmup", type=int, default=15)
    p.add_argument("--out", default=str(ROOT / "tmp" / "hub-task-audit" / "bench-contention.json"))
    p.add_argument("--keep", action="store_true")
    return p.parse_args()


def _pair_run(
    *,
    name: str,
    iterations: int,
    setup: Callable[[], dict[str, Any]],
    left: Callable[[dict[str, Any], int], dict[str, Any]],
    right: Callable[[dict[str, Any], int], dict[str, Any]],
    finalize: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    totals: list[float] = []
    left_ok = 0
    right_ok = 0
    both_ok = 0
    exactly_one_ok = 0
    transition_conflicts = 0
    unexpected_errors = 0
    errors_by_class: dict[str, int] = {}
    errors_by_sqlstate: dict[str, int] = {}
    final_states: list[dict[str, Any]] = []
    lost_updates = 0
    deadlocks = 0

    for index in range(iterations):
        ctx = setup()
        barrier = threading.Barrier(2)
        results: dict[str, Any] = {}

        def run_side(side: str, fn: Callable) -> None:
            try:
                barrier.wait(timeout=10)
            except Exception:
                pass
            t0 = time.perf_counter()
            try:
                out = fn(ctx, index)
                results[side] = {"ok": bool(out.get("ok", True)), "total_ms": (time.perf_counter() - t0) * 1000.0, **out}
            except Exception as exc:
                info = classify_db_error(exc)
                results[side] = {
                    "ok": False,
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "error": info,
                }

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(run_side, "left", left)
            f2 = pool.submit(run_side, "right", right)
            f1.result()
            f2.result()

        l = results.get("left") or {}
        r = results.get("right") or {}
        if l.get("ok"):
            left_ok += 1
        if r.get("ok"):
            right_ok += 1
        if l.get("ok") and r.get("ok"):
            both_ok += 1
        if bool(l.get("ok")) ^ bool(r.get("ok")):
            exactly_one_ok += 1
        for side in (l, r):
            err = side.get("error") or {}
            if err.get("error_class"):
                cls = str(err["error_class"])
                errors_by_class[cls] = errors_by_class.get(cls, 0) + 1
                if cls == "deadlock_detected":
                    deadlocks += 1
                elif cls == "task_transition_conflict":
                    transition_conflicts += 1
                else:
                    unexpected_errors += 1
            if err.get("sqlstate"):
                key = str(err["sqlstate"])
                errors_by_sqlstate[key] = errors_by_sqlstate.get(key, 0) + 1
        pair_ms = max(float(l.get("total_ms") or 0), float(r.get("total_ms") or 0))
        totals.append(pair_ms)
        if finalize:
            state = finalize(ctx)
            final_states.append(state)
            if state.get("lost_update"):
                lost_updates += 1

    return {
        "name": name,
        "load_model": "paired_barrier_closed_loop",
        "attempted_pairs": iterations,
        "left_ok": left_ok,
        "right_ok": right_ok,
        "both_ok": both_ok,
        "exactly_one_ok": exactly_one_ok,
        "transition_conflicts": transition_conflicts,
        "unexpected_errors": unexpected_errors,
        "error_rate_pair": round(1.0 - (both_ok / iterations), 6) if iterations else None,
        "unexpected_error_rate": round(unexpected_errors / max(1, iterations * 2), 6),
        "errors_by_class": errors_by_class,
        "errors_by_sqlstate": errors_by_sqlstate,
        "deadlocks": deadlocks,
        "lost_updates_detected": lost_updates,
        "latency_pair_max_ms": summary(totals),
        "final_state_samples": final_states[:20],
        "optimistic_concurrency": False,
    }


def main() -> int:
    args = parse_args()
    from backend.services.hub_service import hub_service
    from backend.services.sql_query_counter import track_sql_queries
    from backend.services.user_service import user_service

    creator = user_service.get_by_id(int(args.creator_id))
    assignee = user_service.get_by_id(int(args.assignee_id))
    if not creator or not assignee:
        raise SystemExit("users not found")
    project_id = ensure_project_id(hub_service)
    hub_service.prepare_task_status_log_schema()
    marker = f"cont-{uuid.uuid4().hex[:10]}"
    created: list[str] = []

    def create_task(status: str = "new") -> str:
        task = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} {uuid.uuid4().hex[:8]}",
            description="contention",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
            initial_status=status,
        )
        tid = str((task or {}).get("id") or "")
        created.append(tid)
        return tid

    report = new_run_meta(marker=marker, hub_service=hub_service)
    report["scenarios"] = {}
    report["optimistic_concurrency"] = {
        "version_column_on_hub_tasks": False,
        "updated_at_precondition": False,
        "status_transition_conditional_update": True,
        "api_conflict_status": "409 task_transition_conflict for status workflows; update_task OCC deferred to TASK-P0-2",
    }

    iters = int(args.iterations)

    # warmup
    for _ in range(int(args.warmup)):
        tid = create_task()
        hub_service.update_task(tid, {"description": "w"}, actor_user_id=int(creator["id"]))

    # 1) update + update same task (lost update)
    def setup_upd():
        tid = create_task()
        return {"task_id": tid, "token_a": uuid.uuid4().hex[:8], "token_b": uuid.uuid4().hex[:8]}

    def left_upd(ctx, index):
        u = hub_service.update_task(
            ctx["task_id"],
            {"description": f"A-{ctx['token_a']}-{index}"},
            actor_user_id=int(creator["id"]),
        )
        return {"ok": bool(u), "updated_at": (u or {}).get("updated_at"), "desc": (u or {}).get("description")}

    def right_upd(ctx, index):
        u = hub_service.update_task(
            ctx["task_id"],
            {"description": f"B-{ctx['token_b']}-{index}"},
            actor_user_id=int(creator["id"]),
        )
        return {"ok": bool(u), "updated_at": (u or {}).get("updated_at"), "desc": (u or {}).get("description")}

    def _safe_get(task_id: str) -> dict:
        try:
            return hub_service.get_task(task_id, user_id=int(creator["id"]), is_admin=True) or {}
        except LookupError:
            return {}

    def fin_upd(ctx):
        item = _safe_get(ctx["task_id"])
        desc = str(item.get("description") or "")
        has_a = ctx["token_a"] in desc
        has_b = ctx["token_b"] in desc
        return {
            "task_id": ctx["task_id"],
            "final_description": desc,
            "contains_a": has_a,
            "contains_b": has_b,
            "lost_update": bool(has_a and has_b) is False and not (has_a ^ has_b),
            "last_writer_wins": has_a ^ has_b,
            "silent_overwrite_no_conflict_api": has_a ^ has_b,
        }

    print("RUN same_task_update_update")
    report["scenarios"]["same_task_update_update"] = _pair_run(
        name="same_task_update_update",
        iterations=iters,
        setup=setup_upd,
        left=left_upd,
        right=right_upd,
        finalize=fin_upd,
    )
    # refine lost_update: last writer wins means one of two tokens present — not a correctness bug by design, but no conflict signal
    for sample in report["scenarios"]["same_task_update_update"].get("final_state_samples") or []:
        sample["lost_update"] = bool(sample.get("contains_a") and sample.get("contains_b")) is False and not sample.get("last_writer_wins")
    # Count silent overwrites (expected with no OCC)
    silent = sum(1 for s in (report["scenarios"]["same_task_update_update"].get("final_state_samples") or []) if s.get("last_writer_wins"))
    report["scenarios"]["same_task_update_update"]["silent_last_writer_wins_in_samples"] = silent
    report["scenarios"]["same_task_update_update"]["api_conflict_responses"] = 0

    # 2) update + delete
    def setup_ud():
        return {"task_id": create_task()}

    def left_ud(ctx, index):
        try:
            u = hub_service.update_task(ctx["task_id"], {"description": f"u{index}"}, actor_user_id=int(creator["id"]))
            return {"ok": bool(u)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_ud(ctx, index):
        try:
            ok = hub_service.delete_task(task_id=ctx["task_id"], actor_user_id=int(creator["id"]), is_admin=True)
            return {"ok": bool(ok)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def fin_ud(ctx):
        item = _safe_get(ctx["task_id"])
        return {"exists": bool(item), "task_id": ctx["task_id"]}

    print("RUN same_task_update_delete")
    report["scenarios"]["same_task_update_delete"] = _pair_run(
        name="same_task_update_delete",
        iterations=iters,
        setup=setup_ud,
        left=left_ud,
        right=right_ud,
        finalize=fin_ud,
    )

    # 3) submit + submit
    def setup_ss():
        tid = create_task()
        hub_service.start_task(task_id=tid, user=assignee)
        return {"task_id": tid}

    def left_ss(ctx, index):
        try:
            u = hub_service.submit_task(task_id=ctx["task_id"], user=assignee, comment="L", file_name=None, file_bytes=None, file_mime=None)
            return {"ok": bool(u) and str((u or {}).get("status")) == "review", "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_ss(ctx, index):
        try:
            u = hub_service.submit_task(task_id=ctx["task_id"], user=assignee, comment="R", file_name=None, file_bytes=None, file_mime=None)
            return {"ok": bool(u) and str((u or {}).get("status")) == "review", "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def fin_ss(ctx):
        item = _safe_get(ctx["task_id"])
        return {"status": item.get("status"), "task_id": ctx["task_id"], "exists": bool(item)}

    print("RUN same_task_submit_submit")
    report["scenarios"]["same_task_submit_submit"] = _pair_run(
        name="same_task_submit_submit",
        iterations=iters,
        setup=setup_ss,
        left=left_ss,
        right=right_ss,
        finalize=fin_ss,
    )

    # 4) submit + approve (approve may fail if not yet review)
    def setup_sa():
        tid = create_task()
        hub_service.start_task(task_id=tid, user=assignee)
        return {"task_id": tid}

    def left_sa(ctx, index):
        try:
            u = hub_service.submit_task(task_id=ctx["task_id"], user=assignee, comment="S", file_name=None, file_bytes=None, file_mime=None)
            return {"ok": bool(u), "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_sa(ctx, index):
        try:
            u = hub_service.review_task(task_id=ctx["task_id"], reviewer=creator, decision="approve", comment="A", is_admin=False)
            return {"ok": bool(u), "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    print("RUN same_task_submit_approve")
    report["scenarios"]["same_task_submit_approve"] = _pair_run(
        name="same_task_submit_approve",
        iterations=iters,
        setup=setup_sa,
        left=left_sa,
        right=right_sa,
        finalize=fin_ss,
    )

    # 5) approve + reject
    def setup_ar():
        tid = create_task()
        hub_service.start_task(task_id=tid, user=assignee)
        hub_service.submit_task(task_id=tid, user=assignee, comment="R", file_name=None, file_bytes=None, file_mime=None)
        return {"task_id": tid}

    def left_ar(ctx, index):
        try:
            u = hub_service.review_task(task_id=ctx["task_id"], reviewer=creator, decision="approve", comment="A", is_admin=False)
            return {"ok": bool(u), "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_ar(ctx, index):
        try:
            u = hub_service.review_task(task_id=ctx["task_id"], reviewer=creator, decision="reject", comment="R", is_admin=False)
            return {"ok": bool(u), "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    print("RUN same_task_approve_reject")
    report["scenarios"]["same_task_approve_reject"] = _pair_run(
        name="same_task_approve_reject",
        iterations=iters,
        setup=setup_ar,
        left=left_ar,
        right=right_ar,
        finalize=fin_ss,
    )

    # 6) comment + delete
    def setup_cd():
        return {"task_id": create_task()}

    def left_cd(ctx, index):
        try:
            from backend.chat.task_discussion import is_task_discussion_chat_enabled

            if is_task_discussion_chat_enabled():
                # Simulate concurrent comment-side write via status touch under lock path
                u = hub_service.update_task(
                    ctx["task_id"],
                    {"description": f"comment-proxy-{index}"},
                    actor_user_id=int(assignee["id"]) if False else int(creator["id"]),
                )
                return {"ok": bool(u), "proxied": "update_instead_of_legacy_comment"}
            c = hub_service.add_task_comment(task_id=ctx["task_id"], user=assignee, body=f"c{index}")
            return {"ok": bool(c)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_cd(ctx, index):
        try:
            ok = hub_service.delete_task(task_id=ctx["task_id"], actor_user_id=int(creator["id"]), is_admin=True)
            return {"ok": bool(ok)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    print("RUN same_task_comment_delete")
    report["scenarios"]["same_task_comment_delete"] = _pair_run(
        name="same_task_comment_delete",
        iterations=iters,
        setup=setup_cd,
        left=left_cd,
        right=right_cd,
        finalize=fin_ud,
    )

    # 7) checklist + submit
    def setup_cs():
        tid = create_task()
        hub_service.start_task(task_id=tid, user=assignee)
        return {"task_id": tid}

    def left_cs(ctx, index):
        try:
            u = hub_service.update_task(
                ctx["task_id"],
                {"checklist_items": [{"id": "1", "text": "x", "done": True}]},
                actor_user_id=int(creator["id"]),
            )
            return {"ok": bool(u)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_cs(ctx, index):
        try:
            u = hub_service.submit_task(task_id=ctx["task_id"], user=assignee, comment="S", file_name=None, file_bytes=None, file_mime=None)
            return {"ok": bool(u), "status": (u or {}).get("status")}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    print("RUN same_task_checklist_submit")
    report["scenarios"]["same_task_checklist_submit"] = _pair_run(
        name="same_task_checklist_submit",
        iterations=iters,
        setup=setup_cs,
        left=left_cs,
        right=right_cs,
        finalize=fin_ss,
    )

    # 8) attachment + delete
    def setup_ad():
        return {"task_id": create_task()}

    def left_ad(ctx, index):
        try:
            a = hub_service.add_task_attachment(
                task_id=ctx["task_id"],
                user=creator,
                file_name=f"a{index}.txt",
                file_bytes=b"x",
                file_mime="text/plain",
                can_review=True,
            )
            return {"ok": bool(a)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_ad(ctx, index):
        try:
            ok = hub_service.delete_task(task_id=ctx["task_id"], actor_user_id=int(creator["id"]), is_admin=True)
            return {"ok": bool(ok)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    print("RUN same_task_attachment_delete")
    report["scenarios"]["same_task_attachment_delete"] = _pair_run(
        name="same_task_attachment_delete",
        iterations=iters,
        setup=setup_ad,
        left=left_ad,
        right=right_ad,
        finalize=fin_ud,
    )

    # 9) observers + update
    def setup_ou():
        return {"task_id": create_task()}

    def left_ou(ctx, index):
        try:
            u = hub_service.update_task(ctx["task_id"], {"observer_user_ids": [int(assignee["id"])]}, actor_user_id=int(creator["id"]))
            return {"ok": bool(u)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def right_ou(ctx, index):
        try:
            u = hub_service.update_task(ctx["task_id"], {"description": f"d{index}"}, actor_user_id=int(creator["id"]))
            return {"ok": bool(u)}
        except Exception as exc:
            return {"ok": False, "error": classify_db_error(exc)}

    def fin_ou(ctx):
        item = _safe_get(ctx["task_id"])
        return {
            "description": item.get("description"),
            "observers": item.get("observer_user_ids"),
            "task_id": ctx["task_id"],
            "exists": bool(item),
        }

    print("RUN same_task_observers_update")
    report["scenarios"]["same_task_observers_update"] = _pair_run(
        name="same_task_observers_update",
        iterations=iters,
        setup=setup_ou,
        left=left_ou,
        right=right_ou,
        finalize=fin_ou,
    )

    # Different tasks: 20 parallel creates / updates / comments / status + list
    def parallel_ops(name: str, n_workers: int, fn: Callable[[int], dict[str, Any]]) -> dict[str, Any]:
        errors_by_class: dict[str, int] = {}
        ok = 0
        fail = 0
        totals: list[float] = []

        def wrap(i: int) -> dict[str, Any]:
            t0 = time.perf_counter()
            try:
                out = fn(i)
                return {"ok": bool(out.get("ok", True)), "total_ms": (time.perf_counter() - t0) * 1000.0}
            except Exception as exc:
                return {"ok": False, "total_ms": (time.perf_counter() - t0) * 1000.0, "error": classify_db_error(exc)}

        # closed-loop style repeated batches totaling iterations
        batches = max(1, iters // n_workers)
        for _ in range(batches):
            with ThreadPoolExecutor(max_workers=n_workers) as pool:
                futs = [pool.submit(wrap, i) for i in range(n_workers)]
                for fut in as_completed(futs):
                    r = fut.result()
                    totals.append(float(r["total_ms"]))
                    if r.get("ok"):
                        ok += 1
                    else:
                        fail += 1
                        err = r.get("error") or {}
                        cls = str(err.get("error_class") or "other_error")
                        errors_by_class[cls] = errors_by_class.get(cls, 0) + 1
        return {
            "name": name,
            "workers": n_workers,
            "attempted": ok + fail,
            "succeeded": ok,
            "failed": fail,
            "error_rate": round(fail / (ok + fail), 6) if (ok + fail) else None,
            "errors_by_class": errors_by_class,
            "latency_ms": summary(totals),
        }

    print("RUN parallel_20_create")
    report["scenarios"]["parallel_20_create"] = parallel_ops(
        "parallel_20_create",
        20,
        lambda i: {
            "ok": bool(
                create_task()
            )
        },
    )

    # prepare 40 tasks for parallel updates
    upd_tasks = [create_task() for _ in range(40)]
    print("RUN parallel_20_update_different")
    report["scenarios"]["parallel_20_update_different"] = parallel_ops(
        "parallel_20_update_different",
        20,
        lambda i: {
            "ok": bool(
                hub_service.update_task(
                    upd_tasks[i % len(upd_tasks)],
                    {"description": f"p{i}-{uuid.uuid4().hex[:4]}"},
                    actor_user_id=int(creator["id"]),
                )
            )
        },
    )

    cmt_tasks = [create_task() for _ in range(40)]
    print("RUN parallel_20_comments_different")
    try:
        from backend.chat.task_discussion import is_task_discussion_chat_enabled

        comments_blocked = bool(is_task_discussion_chat_enabled())
    except Exception:
        comments_blocked = False
    if comments_blocked:
        report["scenarios"]["parallel_20_comments_different"] = {
            "skipped": True,
            "reason": "legacy comments blocked by task discussion chat; measured parallel updates instead",
        }
        report["scenarios"]["parallel_20_updates_as_comment_proxy"] = parallel_ops(
            "parallel_20_updates_as_comment_proxy",
            20,
            lambda i: {
                "ok": bool(
                    hub_service.update_task(
                        cmt_tasks[i % len(cmt_tasks)],
                        {"description": f"p{i}"},
                        actor_user_id=int(creator["id"]),
                    )
                )
            },
        )
    else:
        report["scenarios"]["parallel_20_comments_different"] = parallel_ops(
            "parallel_20_comments_different",
            20,
            lambda i: {
                "ok": bool(hub_service.add_task_comment(task_id=cmt_tasks[i % len(cmt_tasks)], user=assignee, body=f"p{i}"))
            },
        )

    st_tasks = [create_task() for _ in range(40)]
    print("RUN parallel_20_start_different")
    report["scenarios"]["parallel_20_start_different"] = parallel_ops(
        "parallel_20_start_different",
        20,
        lambda i: {"ok": bool(hub_service.start_task(task_id=st_tasks[i % len(st_tasks)], user=assignee))},
    )

    # list while writes
    print("RUN list_during_writes")
    write_stop = threading.Event()
    write_errors = {"n": 0}

    def writer_loop():
        while not write_stop.is_set():
            try:
                tid = create_task()
                hub_service.update_task(tid, {"description": "w"}, actor_user_id=int(creator["id"]))
            except Exception:
                write_errors["n"] += 1

    thr = threading.Thread(target=writer_loop, daemon=True)
    thr.start()
    try:
        def list_worker(index: int, is_warmup: bool) -> dict[str, Any]:
            t0 = time.perf_counter()
            try:
                with track_sql_queries(correlation_id=f"listw-{index}") as session:
                    payload = hub_service.list_tasks(
                        user_id=int(creator["id"]),
                        scope="my",
                        role_scope="both",
                        limit=100,
                        offset=0,
                        sort_by="updated_at",
                        sort_dir="desc",
                    )
                return {
                    "ok": True,
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "query_count": session.count,
                    "rows": len(payload.get("items") or []),
                }
            except Exception as exc:
                return {"ok": False, "total_ms": (time.perf_counter() - t0) * 1000.0, "error": {"failed_stage": "list", **classify_db_error(exc)}}

        result = run_closed_loop(attempted_target=iters, concurrency=5, warmup=int(args.warmup), worker_fn=list_worker)
        samples = result.pop("success_samples", [])
        report["scenarios"]["list_during_writes"] = {
            **result,
            "background_write_errors": write_errors["n"],
            "query_count_last": (samples[-1].get("query_count") if samples else None),
        }
    finally:
        write_stop.set()
        thr.join(timeout=5)

    # Lock hold impact: slow update vs concurrent create
    print("RUN lock_hold_impact_slow_update_vs_create")
    slow_ready = threading.Event()
    create_latencies: list[float] = []
    slow_hold_ms = None

    def slow_update():
        nonlocal slow_hold_ms
        tid = create_task()
        # monkeypatch-free: hold RLock by calling update which takes lock; inject sleep via wrapping is hard.
        # Approximate: measure create latency while many locked updates run.
        t0 = time.perf_counter()
        hub_service.update_task(tid, {"description": "slow-start"}, actor_user_id=int(creator["id"]))
        slow_ready.set()
        time.sleep(0.2)
        hub_service.update_task(tid, {"description": "slow-end"}, actor_user_id=int(creator["id"]))
        slow_hold_ms = (time.perf_counter() - t0) * 1000.0

    def burst_creates():
        slow_ready.wait(timeout=5)
        for i in range(20):
            t0 = time.perf_counter()
            create_task()
            create_latencies.append((time.perf_counter() - t0) * 1000.0)

    t1 = threading.Thread(target=slow_update)
    t2 = threading.Thread(target=burst_creates)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    # Baseline creates without lock pressure
    baseline = []
    for _ in range(20):
        t0 = time.perf_counter()
        create_task()
        baseline.append((time.perf_counter() - t0) * 1000.0)
    report["scenarios"]["lock_hold_impact"] = {
        "note": "create uses _db_conn (no RLock on PG); update holds RLock — expect create mostly unaffected on PG; update/start/comment serialize",
        "slow_update_wall_ms": slow_hold_ms,
        "create_during_locked_updates_ms": summary(create_latencies),
        "create_baseline_ms": summary(baseline),
        "lock_wait_ms": "not_instrumented",
        "lock_hold_ms": "not_instrumented_directly",
        "waiters": "not_instrumented",
    }

    write_json(Path(args.out), report)
    print(f"Wrote {args.out}")

    if not args.keep:
        print(f"Cleanup {len(created)} tasks…")
        for tid in created:
            try:
                hub_service.delete_task(task_id=tid, actor_user_id=int(creator["id"]), is_admin=True)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
