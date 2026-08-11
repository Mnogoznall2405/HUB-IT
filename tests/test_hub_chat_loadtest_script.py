from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "loadtest_hub_chat_sessions.py"
SEED_PATH = PROJECT_ROOT / "scripts" / "seed_hub_chat_loadtest_users.py"


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_percentile_ms_and_role_distribution():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script")

    assert module.percentile_ms([100.0, 200.0, 300.0, 400.0], 95) == 385.0
    roles = [module.resolve_role(index) for index in range(10)]
    assert roles.count("busy_hub") == 1
    assert roles.count("active_chat") == 3
    assert roles.count("idle") == 6


def test_api_to_ws_url_and_conversation_helpers():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_helpers")

    assert module.api_to_ws_url("http://127.0.0.1:8001/api/v1") == "ws://127.0.0.1:8001/api/v1/chat/ws"
    assert module.api_to_ws_url("https://hub.example/api/v1") == "wss://hub.example/api/v1/chat/ws"
    assert module.first_conversation_id({"items": [{"id": "c-1"}, {"id": "c-2"}]}) == "c-1"
    assert module.first_message_id({"messages": {"items": [{"id": "m-9"}]}}) == "m-9"
    assert module.client_ip_for_worker("10.10.20.50", 0) == "10.10.20.50"
    assert module.client_ip_for_worker("10.10.20.50", 1) == "10.10.20.51"
    assert module.client_ip_for_worker("10.10.20.250", 10).startswith("10.10.")


def test_build_report_evaluates_session_slos():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_report")
    stats = module.RunStats(slow_threshold_ms=100.0)
    stats.request_count = 20
    stats.error_count = 0
    stats.scenario_loops = 5
    stats.ws_connects = 50
    stats.ws_disconnects = 50
    stats.ws_reconnects = 1
    stats.finished_at = stats.started_at + 60.0
    stats.timings_ms["hub_dashboard"] = [400.0, 500.0]
    stats.timings_ms["hub_tasks"] = [300.0, 450.0]
    stats.timings_ms["chat_conversations"] = [200.0, 250.0]
    stats.timings_ms["chat_thread_bootstrap"] = [700.0, 900.0]
    stats.timings_ms["ws_connect"] = [120.0, 180.0]
    stats.timings_ms["ws_ping"] = [40.0, 55.0]
    stats.rss_samples_mb = [700.0, 740.0]
    stats.error_by_stage = {"loop": 0}
    stats.slow_samples = [
        {
            "stage": "hub_dashboard",
            "elapsed_ms": 1500.0,
            "username": "loadtest01",
            "correlation_id": "lt-abc",
            "path": "/hub/dashboard",
            "at_mono": 12.0,
        }
    ]

    report = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=50,
            duration_sec=900,
            think_time_sec=2.5,
            enable_writes=False,
            conversation_id="c-load",
        ),
    )

    assert report["slos"]["error_rate_lt_1pct"] is True
    assert report["slos"]["hub_dashboard_p95_le_2000ms"] is True
    assert report["slos"]["chat_thread_bootstrap_p95_le_2000ms"] is True
    assert report["slos"]["ws_ping_p95_le_1000ms"] is True
    assert report["ws"]["connects"] == 50
    assert report["slow_samples"][0]["correlation_id"] == "lt-abc"

    diagnosis = module.build_diagnosis(
        report,
        server_metrics={
            "ok": True,
            "hotspots": [
                {
                    "severity": "medium",
                    "reason": "slow_p95",
                    "method": "GET",
                    "path": "/api/v1/hub/dashboard",
                    "p95_ms": 1800,
                    "server_error_rate": 0.0,
                }
            ],
            "pools": {"app": {"checkedout": 2}},
        },
        chat_health={"ok": True, "realtime_mode": "redis", "route_metrics": {"conversations": {"count": 10, "p95_ms": 120}}},
    )
    assert diagnosis["client_bottlenecks"][0]["stage"]
    assert "where_to_look" in diagnosis
    md = module.render_diagnosis_markdown(report, diagnosis)
    assert "Hub+Chat loadtest diagnosis" in md
    assert "Client bottlenecks" in md


def test_delivery_tracker_correlates_recipient_event_and_ignores_sender_echo():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_delivery")
    stats = module.RunStats(slow_threshold_ms=100.0)
    stats.phase = "measurement"
    stats.measurement_started_at = stats.started_at
    tracker = module.DeliveryTracker(stats)

    async def exercise() -> None:
        client_message_id = "lt-dm-delivery-1"
        await tracker.register(
            client_message_id,
            kind="dm",
            sender_username="loadtest01",
            expected_receiver="loadtest02",
        )
        sender_echo = await tracker.observe(
            receiver_username="loadtest01",
            message={
                "type": "chat.message.created",
                "payload": {"client_message_id": client_message_id},
            },
        )
        recipient_event = await tracker.observe(
            receiver_username="loadtest02",
            message={
                "type": "chat.message.created",
                "payload": {"client_message_id": client_message_id},
            },
        )
        assert sender_echo is False
        assert recipient_event is True

    asyncio.run(exercise())

    assert tracker.registered == 1
    assert tracker.observed == 1
    assert tracker.pending_count == 0
    assert len(stats.timings_ms["ws_delivery_event"]) == 1
    assert len(stats.timings_ms["ws_delivery_event_dm"]) == 1


def test_incoming_read_tracker_coalesces_to_latest_message_per_conversation():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_read_tracker")
    tracker = module.IncomingReadTracker()

    assert tracker.observe({
        "type": "chat.message.created",
        "payload": {
            "id": "m-1",
            "conversation_id": "c-1",
            "conversation_seq": 10,
            "is_own": False,
        },
    }) is True
    assert tracker.observe({
        "type": "chat.message.created",
        "payload": {
            "id": "m-2",
            "conversation_id": "c-1",
            "conversation_seq": 11,
            "is_own": False,
        },
    }) is True
    assert tracker.observe({
        "type": "chat.message.created",
        "payload": {
            "id": "own-1",
            "conversation_id": "c-1",
            "conversation_seq": 12,
            "is_own": True,
        },
    }) is False

    assert tracker.pending() == [("c-1", "m-2")]

    # A newer event arriving while m-2 waits for ACK must remain pending.
    assert tracker.observe({
        "type": "chat.message.created",
        "payload": {
            "id": "m-3",
            "conversation_id": "c-1",
            "conversation_seq": 12,
            "is_own": False,
        },
    }) is True
    tracker.complete("c-1", "m-2")
    assert tracker.pending() == [("c-1", "m-3")]
    tracker.complete("c-1", "m-3")
    assert tracker.pending() == []

    # A delayed older event must not move the read target backwards.
    assert tracker.observe({
        "type": "chat.message.created",
        "payload": {
            "id": "m-old",
            "conversation_id": "c-1",
            "conversation_seq": 9,
            "is_own": False,
        },
    }) is False
    assert tracker.pending() == []


def test_delivery_slo_fails_when_a_registered_message_is_missing():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_delivery_slo")
    stats = module.RunStats()
    stats.request_count = 10
    stats.finished_at = stats.started_at + 60.0
    stats.delivery_registered = 10
    stats.delivery_observed = 9
    stats.delivery_missing = 1
    stats.timings_ms["ws_delivery_event"] = [100.0, 150.0, 200.0]

    report = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=100,
            duration_sec=60,
            think_time_sec=1.0,
            enable_writes=True,
            conversation_id="",
            scenario_profile="steady",
            steady_state_gates=True,
        ),
    )

    assert report["delivery"]["registered"] == 10
    assert report["delivery"]["observed"] == 9
    assert report["delivery"]["missing"] == 1
    assert report["slos"]["delivery_missing_eq_0"] is False


def test_capacity_150_slo_profile_requires_one_second_delivery_without_mail_io():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_capacity_150")
    stats = module.RunStats()
    stats.request_count = 30
    stats.finished_at = stats.started_at + 60.0
    stats.delivery_registered = 3
    stats.delivery_observed = 3
    stats.timings_ms["hub_dashboard"] = [900.0, 1100.0]
    stats.timings_ms["hub_tasks"] = [800.0, 1200.0]
    stats.timings_ms["hub_notifications_poll"] = [300.0, 600.0]
    stats.timings_ms["chat_conversations"] = [200.0]
    stats.timings_ms["chat_thread_bootstrap"] = [300.0]
    stats.timings_ms["ws_connect"] = [100.0]
    stats.timings_ms["ws_send_message"] = [200.0, 450.0]
    stats.timings_ms["ws_delivery_event"] = [400.0, 900.0]

    report = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=150,
            duration_sec=600,
            think_time_sec=2.0,
            enable_writes=True,
            conversation_id="",
            scenario_profile="steady",
            steady_state_gates=True,
            slo_profile="capacity_150",
        ),
    )

    assert report["slo_profile"] == "capacity_150"
    assert report["mail_mode"] == "hub_cache_only"
    assert report["mail_external_calls"] == 0
    assert report["slos"]["ws_send_message_p95_le_500ms"] is True
    assert report["slos"]["delivery_p95_le_1000ms"] is True
    assert report["slos"]["delivery_p99_le_2000ms"] is True
    assert report["slos"]["hub_notifications_poll_p95_le_1000ms"] is True


def test_build_report_stampede_and_reconnect_objectives():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_stampede")
    stats = module.RunStats(slow_threshold_ms=100.0)
    stats.request_count = 100
    stats.error_count = 0
    stats.phase = "measurement"
    stats.measurement_started_at = stats.started_at
    stats.finished_at = stats.started_at + 60.0
    stats.timings_ms["ws_send_message"] = [100.0, 200.0, 400.0, 600.0]
    stats.timings_ms["ws_reconnect_recovery"] = [300.0, 800.0, 1200.0]
    stats.timings_ms["hub_dashboard"] = [100.0]
    stats.timings_ms["hub_tasks"] = [100.0]
    stats.timings_ms["chat_conversations"] = [100.0]
    stats.timings_ms["chat_thread_bootstrap"] = [100.0]
    stats.timings_ms["ws_connect"] = [100.0]
    stats.read_throttle_total["503:http_loop"] = 12
    stats.reconnect_attempts = 10
    stats.reconnect_successes = 10

    stampede = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=100,
            duration_sec=60,
            think_time_sec=0.8,
            enable_writes=True,
            conversation_id="",
            scenario_profile="stampede",
            steady_state_gates=False,
        ),
    )
    assert stampede["stampede_gates"]["read_503_allowed"] is True
    assert stampede["stampede_gates"]["send_errors_eq_0"] is True
    assert stampede["slos"]["stampede_objective"] is True
    assert stampede["slos"]["error_rate_lt_1pct"] is True

    reconnect = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=50,
            duration_sec=60,
            think_time_sec=1.0,
            enable_writes=True,
            conversation_id="",
            scenario_profile="reconnect",
            steady_state_gates=False,
        ),
    )
    assert reconnect["reconnect_gates"]["reconnect_success_rate_ge_0_95"] is True
    assert reconnect["slos"]["reconnect_objective"] is True


def test_seed_username_for_zero_pads():
    module = _load_module(SEED_PATH, "hub_chat_seed_users_script")
    assert module.username_for("loadtest", 1) == "loadtest01"
    assert module.username_for("loadtest", 50) == "loadtest50"


def test_dm_pairing_adjacent_and_ring():
    dm_seed = PROJECT_ROOT / "scripts" / "seed_hub_chat_loadtest_dms.py"
    module = _load_module(dm_seed, "hub_chat_seed_dms_script")
    users = [
        {"id": 1, "username": "loadtest01"},
        {"id": 2, "username": "loadtest02"},
        {"id": 3, "username": "loadtest03"},
        {"id": 4, "username": "loadtest04"},
    ]
    adjacent = module.pair_users(users, pairing="adjacent")
    assert len(adjacent) == 2
    assert {int(a["id"]) for a, _b in adjacent} == {1, 3}
    ring = module.pair_users(users, pairing="ring")
    assert len(ring) == 4


def test_seed_tasks_specs_cover_assignee_and_creator_roles():
    tasks_seed = PROJECT_ROOT / "scripts" / "seed_hub_chat_loadtest_tasks.py"
    module = _load_module(tasks_seed, "hub_chat_seed_tasks_script")
    users = [
        {"id": 1, "username": "loadtest01", "role": "viewer"},
        {"id": 2, "username": "loadtest02", "role": "viewer"},
        {"id": 3, "username": "loadtest03", "role": "viewer"},
    ]
    specs = module.task_specs_for_user(
        user_index=0,
        user=users[0],
        peers=users[1:],
        tasks_per_user=6,
    )
    assert len(specs) == 6
    assert all(str(item["title"]).startswith(module.TITLE_PREFIX) for item in specs)
    assert any(int(item["assignee_user_id"]) == 1 for item in specs)
    assert any(int(item["creator"]["id"]) == 1 for item in specs)
    assert {item["status"] for item in specs} >= {"new", "in_progress", "done"}


def test_file_preview_flow_polls_async_queue_until_ready(monkeypatch):
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_file_preview")
    request = httpx.Request("GET", "http://chat.test/preview")
    upload = httpx.Response(
        200,
        request=httpx.Request("POST", "http://chat.test/messages/files"),
        json={"id": "message-1", "attachments": [{"id": "attachment-1"}]},
    )
    preview_responses = [
        httpx.Response(202, request=request, json={"status": "queued", "retry_after_ms": 100}),
        httpx.Response(202, request=request, json={"status": "processing", "retry_after_ms": 100}),
        httpx.Response(
            200,
            request=request,
            json={"status": "ready", "preview_kind": "office_pdf"},
        ),
        httpx.Response(200, request=request, content=b"%PDF-1.7"),
    ]

    class FakeClient:
        def __init__(self):
            self.preview_calls = 0

        async def post(self, *_args, **_kwargs):
            return upload

        async def get(self, *_args, **_kwargs):
            self.preview_calls += 1
            return preview_responses.pop(0)

        async def request(self, *_args, **_kwargs):
            return preview_responses.pop(0)

    async def no_sleep(_delay):
        return None

    monkeypatch.setattr(module.asyncio, "sleep", no_sleep)
    stats = module.RunStats()
    stats.phase = "measurement"
    client = FakeClient()
    asyncio.run(
        module.run_chat_file_preview_flow(
            client,
            stats,
            conversation_id="conversation-1",
            worker_id=1,
            username="loadtest01",
            role="active_chat",
            timeout_sec=5.0,
            loop_index=1,
        )
    )

    assert client.preview_calls == 3
    assert len(stats.timings_ms["chat_file_upload"]) == 1
    assert len(stats.timings_ms["chat_file_preview"]) == 1
    assert len(stats.timings_ms["chat_file_preview_pdf"]) == 1


def test_worker_teardown_is_bounded_and_does_not_pollute_request_slo():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_bounded_teardown")
    stats = module.RunStats()

    async def scenario() -> None:
        blocker = asyncio.Event()

        async def stuck_worker():
            await blocker.wait()

        worker = asyncio.create_task(stuck_worker())
        failures = await module.settle_worker_tasks(
            [worker],
            stats,
            graceful_timeout_sec=0.01,
            cancel_timeout_sec=0.1,
        )
        assert failures == []
        assert worker.done()

    asyncio.run(scenario())

    assert stats.teardown_error_count == 1
    assert stats.teardown_error_by_stage == {"worker_grace_timeout": 1}
    assert stats.error_count == 0
    assert stats.request_count == 0

    report = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=1,
            duration_sec=1,
            think_time_sec=0.0,
            enable_writes=False,
            conversation_id="",
        ),
    )
    assert report["teardown"]["error_count"] == 1
    assert report["error_count"] == 0
    assert report["slos"]["error_rate_lt_1pct"] is True


def test_websocket_close_steps_are_individually_bounded():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_bounded_ws_close")
    stats = module.RunStats()

    class NeverClosing:
        async def close(self):
            await asyncio.Event().wait()

    session = SimpleNamespace(close=NeverClosing().close, ws=NeverClosing())

    asyncio.run(
        module.close_ws_session(
            session,
            stats,
            expected=True,
            kind="test_teardown",
            timeout_sec=0.01,
        )
    )

    assert stats.teardown_error_by_stage == {
        "ws_reader_close_timeout": 1,
        "ws_transport_close_timeout": 1,
    }
    assert stats.error_count == 0
    assert stats.ws_disconnects == 1


def test_worker_teardown_timeout_defaults_to_request_delivery_and_close_budget():
    module = _load_module(SCRIPT_PATH, "hub_chat_loadtest_script_teardown_budget")

    assert module.worker_teardown_timeout_sec(
        SimpleNamespace(
            worker_teardown_timeout_sec=0.0,
            request_timeout_sec=25.0,
            delivery_timeout_sec=3.0,
            ws_close_timeout_sec=3.0,
        )
    ) == 31.0
    assert module.worker_teardown_timeout_sec(
        SimpleNamespace(worker_teardown_timeout_sec=7.5)
    ) == 7.5
