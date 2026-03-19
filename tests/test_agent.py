from __future__ import annotations

import json
import sys
from pathlib import Path

import agent
import agent_installer
from agent_version import AGENT_VERSION as SHARED_AGENT_VERSION


PROJECT_ROOT = Path(__file__).resolve().parents[1]
AGENT_SRC = PROJECT_ROOT / "agent" / "src"

if str(AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(AGENT_SRC))

from itinvent_agent import agent as packaged_agent  # noqa: E402


def test_get_outlook_search_roots_defaults_to_d_drive(monkeypatch):
    monkeypatch.delenv("ITINV_OUTLOOK_SEARCH_ROOTS", raising=False)

    roots = agent._get_outlook_search_roots()

    assert [str(path) for path in roots] == ["D:\\"]


def test_get_outlook_search_roots_respects_custom_env(monkeypatch, temp_dir):
    base = Path(temp_dir)
    root_one = base / "Mail"
    root_two = base / "Archive"
    monkeypatch.setenv("ITINV_OUTLOOK_SEARCH_ROOTS", f"{root_one}; {root_two}")

    roots = agent._get_outlook_search_roots()

    assert [str(path) for path in roots] == [str(root_one), str(root_two)]


def test_get_outlook_search_roots_allows_explicit_disable(monkeypatch):
    monkeypatch.setenv("ITINV_OUTLOOK_SEARCH_ROOTS", "   ")

    assert agent._get_outlook_search_roots() == []


def test_scan_outlook_profile_paths_finds_standard_store(temp_dir):
    users_root = Path(temp_dir) / "Users"
    user_dir = users_root / "tester"
    store_path = user_dir / "AppData" / "Local" / "Microsoft" / "Outlook" / "mail.ost"
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text("outlook", encoding="utf-8")

    stores = agent._scan_outlook_profile_paths(users_root=users_root, seen_paths=set())

    assert len(stores) == 1
    assert stores[0]["path"] == str(store_path.resolve())
    assert stores[0]["type"] == "ost"
    assert stores[0]["profile_name"] == "tester"


def test_scan_outlook_extra_roots_finds_nested_store_and_prunes_system_dirs(temp_dir):
    extra_root = Path(temp_dir) / "DDrive"
    wanted = extra_root / "Archive" / "Outlook" / "user.pst"
    skipped = extra_root / "ProgramData" / "Outlook" / "skip.pst"
    wanted.parent.mkdir(parents=True, exist_ok=True)
    skipped.parent.mkdir(parents=True, exist_ok=True)
    wanted.write_text("archive", encoding="utf-8")
    skipped.write_text("skip", encoding="utf-8")

    stores, errors = agent._scan_outlook_extra_roots(roots=[extra_root], seen_paths=set())

    assert errors == 0
    assert [row["path"] for row in stores] == [str(wanted.resolve())]
    assert stores[0]["type"] == "pst"


def test_scan_outlook_extra_roots_deduplicates_profile_hits(temp_dir):
    users_root = Path(temp_dir) / "Users"
    store_path = users_root / "tester" / "Documents" / "Outlook Files" / "mail.pst"
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text("archive", encoding="utf-8")

    seen_paths: set[str] = set()
    profile_stores = agent._scan_outlook_profile_paths(users_root=users_root, seen_paths=seen_paths)
    extra_stores, _ = agent._scan_outlook_extra_roots(roots=[users_root], seen_paths=seen_paths)

    assert len(profile_stores) == 1
    assert extra_stores == []


def test_agent_version_is_shared_between_runtime_and_package():
    assert agent.AGENT_VERSION == SHARED_AGENT_VERSION
    assert packaged_agent.AGENT_VERSION == SHARED_AGENT_VERSION


def _make_inventory_config(**overrides):
    base = {
        "server_url": "https://hubit.zsgp.ru/api/v1/inventory",
        "api_key": "test-key",
        "full_snapshot_interval": 3600,
        "heartbeat_interval": 300,
        "heartbeat_jitter_sec": 60,
        "inventory_queue_batch": 50,
        "inventory_queue_max_items": 1000,
        "inventory_queue_max_age_days": 14,
        "inventory_queue_max_total_mb": 256,
    }
    base.update(overrides)
    return agent.AgentConfig(**base)


def _configure_inventory_queue(monkeypatch, temp_dir):
    root = Path(temp_dir) / "inventory_queue"
    pending = root / "pending"
    dead = root / "dead_letter"
    pending.mkdir(parents=True, exist_ok=True)
    dead.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(agent, "INVENTORY_QUEUE_PENDING_PATH", pending)
    monkeypatch.setattr(agent, "INVENTORY_QUEUE_DEAD_PATH", dead)
    return pending, dead


def test_unified_agent_installers_force_scan_on_demand_defaults():
    root = Path(__file__).resolve().parents[1]

    for rel_path in ("scripts/install_agent_task.ps1", "agent/scripts/install_agent_task.ps1"):
        script_text = (root / rel_path).read_text(encoding="utf-8")
        assert "SCAN_AGENT_SCAN_ON_START" in script_text
        assert "SCAN_AGENT_WATCHDOG_ENABLED" in script_text
        assert "SetEnvironmentVariable" in script_text
        assert "Start-ScheduledTask" in script_text

    for rel_path in ("scripts/uninstall_agent_task.ps1", "agent/scripts/uninstall_agent_task.ps1"):
        script_text = (root / rel_path).read_text(encoding="utf-8")
        assert "ClearInstallerEnv" in script_text
        assert "SkipInstallPathRemoval" in script_text
        assert "SkipProcessStop" in script_text
        assert "RuntimeRoot" in script_text
        assert "LegacyProgramDataRoot" in script_text


def test_runtime_and_packaged_agent_files_have_no_drift():
    root = Path(__file__).resolve().parents[1]
    runtime_text = (root / "agent.py").read_text(encoding="utf-8").replace("\r\n", "\n")
    packaged_text = (root / "agent" / "src" / "itinvent_agent" / "agent.py").read_text(encoding="utf-8").replace(
        "\r\n", "\n"
    )

    assert runtime_text == packaged_text


def test_prune_agent_log_files_keeps_three_total_and_ignores_other_files(temp_dir):
    log_dir = Path(temp_dir) / "Logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    for name in (
        "itinvent_agent.log",
        "itinvent_agent.log.1",
        "itinvent_agent.log.2",
        "itinvent_agent.log.3",
        "itinvent_agent.log.4",
        "itinvent_agent.log.5",
        "other.log",
    ):
        (log_dir / name).write_text(name, encoding="utf-8")

    removed, errors = agent._prune_agent_log_files(log_dir / "itinvent_agent.log", keep_total_files=3)

    assert removed == 3
    assert errors == []
    assert sorted(path.name for path in log_dir.iterdir()) == [
        "itinvent_agent.log",
        "itinvent_agent.log.1",
        "itinvent_agent.log.2",
        "other.log",
    ]


def test_setup_logging_prunes_logs_and_uses_temp_fallback(monkeypatch, temp_dir):
    temp_root = Path(temp_dir)
    program_log_dir = temp_root / "ProgramData" / "Logs"
    program_spool_dir = temp_root / "ProgramData" / "Spool"
    fallback_temp_dir = temp_root / "Temp"
    fallback_temp_dir.mkdir(parents=True, exist_ok=True)
    for name in (
        "itinvent_agent.log.1",
        "itinvent_agent.log.2",
        "itinvent_agent.log.3",
        "itinvent_agent.log.4",
        "itinvent_agent.log.5",
    ):
        (fallback_temp_dir / name).write_text(name, encoding="utf-8")

    monkeypatch.setattr(agent, "PROGRAM_DATA_DIR", program_log_dir)
    monkeypatch.setattr(agent, "PROGRAM_DATA_SPOOL_DIR", program_spool_dir)
    monkeypatch.setattr(agent, "TEMP_DIR", fallback_temp_dir)

    original_mkdir = Path.mkdir

    def fake_mkdir(self, *args, **kwargs):
        if self in {program_log_dir, program_spool_dir}:
            raise OSError("access denied")
        return original_mkdir(self, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", fake_mkdir)

    captured: dict[str, list[tuple] | dict] = {}
    monkeypatch.setattr(agent.logging, "info", lambda *args, **kwargs: captured.setdefault("info", []).append(args))
    monkeypatch.setattr(agent.logging, "warning", lambda *args, **kwargs: captured.setdefault("warning", []).append(args))
    monkeypatch.setattr(agent.logging, "basicConfig", lambda **kwargs: captured.setdefault("basicConfig", kwargs))

    log_path = agent.setup_logging()

    assert log_path == fallback_temp_dir / agent.LOG_FILE_NAME
    assert sorted(path.name for path in fallback_temp_dir.glob("itinvent_agent.log*")) == [
        "itinvent_agent.log",
        "itinvent_agent.log.1",
        "itinvent_agent.log.2",
    ]
    handlers = captured["basicConfig"]["handlers"]  # type: ignore[index]
    assert handlers[0].backupCount == agent.AGENT_LOG_KEEP_TOTAL_FILES - 1
    assert any("Agent log cleanup completed" in call[0] for call in captured.get("info", []))  # type: ignore[union-attr]

    for handler in handlers:
        handler.close()


def test_agent_installer_build_runtime_env_values_preserves_existing_and_forces_on_demand():
    existing = {
        "ITINV_AGENT_SERVER_URL": "https://existing.example/api/v1/inventory",
        "ITINV_SCAN_ENABLED": "0",
        "SCAN_AGENT_SCAN_ON_START": "1",
    }
    overrides = {
        "ITINV_AGENT_API_KEY": "fresh-key",
        "ITINV_SCAN_ENABLED": "",
        "SCAN_AGENT_API_KEY": "",
    }

    values = agent_installer.build_runtime_env_values(existing, overrides)

    assert values["ITINV_AGENT_SERVER_URL"] == "https://existing.example/api/v1/inventory"
    assert values["ITINV_AGENT_API_KEY"] == "fresh-key"
    assert values["ITINV_SCAN_ENABLED"] == "0"
    assert values["SCAN_AGENT_SCAN_ON_START"] == "0"
    assert values["SCAN_AGENT_WATCHDOG_ENABLED"] == "0"
    assert values["ITINV_OUTLOOK_SEARCH_ROOTS"] == "D:\\"


def test_agent_installer_upsert_env_file_updates_existing_values(temp_dir):
    env_path = Path(temp_dir) / ".env"
    env_path.write_text("# comment\nITINV_AGENT_SERVER_URL=https://old.example\nCUSTOM_KEY=keep\n", encoding="utf-8")

    agent_installer.upsert_env_file(
        env_path,
        {
            "ITINV_AGENT_SERVER_URL": "https://new.example",
            "SCAN_AGENT_SCAN_ON_START": "0",
        },
    )

    text = env_path.read_text(encoding="utf-8")
    assert "ITINV_AGENT_SERVER_URL=https://new.example" in text
    assert "CUSTOM_KEY=keep" in text
    assert "SCAN_AGENT_SCAN_ON_START=0" in text


def test_agent_installer_run_msi_install_writes_env_and_calls_task_script(monkeypatch, temp_dir):
    install_dir = Path(temp_dir) / "Agent"
    install_dir.mkdir(parents=True, exist_ok=True)
    runtime_root = Path(temp_dir) / "ProgramData" / "IT-Invent" / "Agent"
    env_path = runtime_root / ".env"
    script_path = install_dir / "scripts" / "install_agent_task.ps1"
    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text("Write-Host test", encoding="utf-8")
    monkeypatch.setattr(agent_installer, "DEFAULT_PROGRAM_DATA_ROOT", runtime_root.parent)
    monkeypatch.setattr(agent_installer, "DEFAULT_RUNTIME_ROOT", runtime_root)

    captured = {}

    monkeypatch.setattr(agent_installer, "resolve_script_path", lambda name: script_path)
    monkeypatch.setattr(agent_installer, "resolve_executable_path", lambda _: install_dir / "ITInventAgent.exe")

    def fake_run_ps(script, args):
        captured["script"] = script
        captured["args"] = list(args)

    monkeypatch.setattr(agent_installer, "_run_powershell_script", fake_run_ps)

    args = type(
        "Args",
        (),
        {
            "install_dir": str(install_dir),
            "env_file_path": "",
            "task_name": "IT-Invent Agent",
            "repeat_minutes": 60,
            "msi_itinv_agent_server_url": "https://hub.example/api/v1/inventory",
            "msi_itinv_agent_api_key": "secure-token",
            "msi_itinv_agent_interval_sec": "",
            "msi_itinv_agent_heartbeat_sec": "",
            "msi_itinv_agent_heartbeat_jitter_sec": "",
            "msi_itinv_scan_enabled": "1",
            "msi_scan_agent_server_base": "https://hub.example/api/v1/scan",
            "msi_scan_agent_api_key": "scan-token",
            "msi_scan_agent_poll_interval_sec": "60",
            "msi_itinv_outlook_search_roots": "D:\\",
        },
    )()

    assert agent_installer.run_msi_install(args, agent.logging) == 0
    env_text = env_path.read_text(encoding="utf-8")
    assert "ITINV_AGENT_SERVER_URL=https://hub.example/api/v1/inventory" in env_text
    assert "SCAN_AGENT_SCAN_ON_START=0" in env_text
    assert "SCAN_AGENT_WATCHDOG_ENABLED=0" in env_text
    assert captured["script"] == script_path
    assert "-StartAfterRegister" in captured["args"]
    assert captured["args"][captured["args"].index("-EnvFilePath") + 1] == str(env_path)


def test_agent_installer_run_msi_install_migrates_legacy_install_dir_env(monkeypatch, temp_dir):
    install_dir = Path(temp_dir) / "Agent"
    install_dir.mkdir(parents=True, exist_ok=True)
    legacy_env_path = install_dir / ".env"
    legacy_env_path.write_text("ITINV_AGENT_SERVER_URL=https://legacy.example/api/v1/inventory\n", encoding="utf-8")
    runtime_root = Path(temp_dir) / "ProgramData" / "IT-Invent" / "Agent"
    env_path = runtime_root / ".env"
    script_path = install_dir / "scripts" / "install_agent_task.ps1"
    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text("Write-Host test", encoding="utf-8")
    monkeypatch.setattr(agent_installer, "DEFAULT_PROGRAM_DATA_ROOT", runtime_root.parent)
    monkeypatch.setattr(agent_installer, "DEFAULT_RUNTIME_ROOT", runtime_root)
    monkeypatch.setattr(agent_installer, "resolve_script_path", lambda name: script_path)
    monkeypatch.setattr(agent_installer, "resolve_executable_path", lambda _: install_dir / "ITInventAgent.exe")
    monkeypatch.setattr(agent_installer, "_run_powershell_script", lambda script, args: None)

    args = type("Args", (), {"install_dir": str(install_dir), "env_file_path": "", "task_name": "IT-Invent Agent", "repeat_minutes": 60})()

    assert agent_installer.run_msi_install(args, agent.logging) == 0
    assert "ITINV_AGENT_SERVER_URL=https://legacy.example/api/v1/inventory" in env_path.read_text(encoding="utf-8")
    assert not legacy_env_path.exists()


def test_agent_installer_run_msi_uninstall_cleanup_uses_safe_script_flags(monkeypatch, temp_dir):
    install_dir = Path(temp_dir) / "Agent"
    script_path = install_dir / "scripts" / "uninstall_agent_task.ps1"
    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text("Write-Host test", encoding="utf-8")
    runtime_root = Path(temp_dir) / "ProgramData" / "IT-Invent" / "Agent"

    captured = {}

    monkeypatch.setattr(agent_installer, "resolve_script_path", lambda name: script_path)
    monkeypatch.setattr(agent_installer, "DEFAULT_PROGRAM_DATA_ROOT", runtime_root.parent)
    monkeypatch.setattr(agent_installer, "DEFAULT_RUNTIME_ROOT", runtime_root)
    monkeypatch.setattr(agent_installer, "stop_agent_processes", lambda **kwargs: [111])

    def fake_run_ps(script, args):
        captured["script"] = script
        captured["args"] = list(args)

    monkeypatch.setattr(agent_installer, "_run_powershell_script", fake_run_ps)

    args = type("Args", (), {"install_dir": str(install_dir), "env_file_path": "", "task_name": "IT-Invent Agent"})()

    assert agent_installer.run_msi_uninstall_cleanup(args, agent.logging) == 0
    assert captured["script"] == script_path
    assert "-SkipProcessStop" not in captured["args"]
    assert "-SkipInstallPathRemoval" in captured["args"]
    assert "-ClearInstallerEnv" in captured["args"]
    assert captured["args"][captured["args"].index("-RuntimeRoot") + 1] == str(runtime_root)
    assert captured["args"][captured["args"].index("-LegacyProgramDataRoot") + 1] == str(runtime_root.parent)


def test_agent_installer_resolve_executable_path_prefers_installed_agent_binary(monkeypatch, temp_dir):
    install_dir = Path(temp_dir) / "Agent"
    install_dir.mkdir(parents=True, exist_ok=True)
    installed_agent = install_dir / "ITInventAgent.exe"
    installed_agent.write_text("binary", encoding="utf-8")
    helper_path = install_dir / "ITInventAgentMsiHelper.exe"
    helper_path.write_text("helper", encoding="utf-8")

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(helper_path))

    assert agent_installer.resolve_executable_path(install_dir) == installed_agent


def test_agent_setup_defines_msi_custom_actions_and_script_assets():
    setup_text = (Path(__file__).resolve().parents[1] / "agent" / "setup.py").read_text(encoding="utf-8")

    assert "A_SET_TARGETDIR_FROM_INSTALLDIR" in setup_text
    assert "A_RUN_AGENT_MSI_INSTALL" in setup_text
    assert "A_RUN_AGENT_MSI_UNINSTALL" in setup_text
    assert '"data": msi_data' in setup_text
    assert '"scripts/install_agent_task.ps1"' in setup_text
    assert '"scripts/uninstall_agent_task.ps1"' in setup_text
    assert '18 + 3072' in setup_text
    assert 'MSI_HELPER_EXECUTABLE_NAME' in setup_text
    assert 'target_name=MSI_HELPER_EXECUTABLE_NAME' in setup_text
    assert 'agent_msi_helper.py' in setup_text
    assert '--install-dir "[TARGETDIR]."' in setup_text
    assert '--env-file-path "[CommonAppDataFolder]IT-Invent\\\\Agent\\\\.env"' in setup_text
    assert 'lib/certifi/cacert.pem' in setup_text


def test_invalid_ca_bundle_falls_back_to_default_tls_verification(monkeypatch):
    monkeypatch.setenv("ITINV_AGENT_SERVER_URL", "https://hubit.zsgp.ru/api/v1/inventory")
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "test-key")
    monkeypatch.setenv("ITINV_AGENT_CA_BUNDLE", r"C:\does-not-exist\cacert.pem")

    config = agent.load_config()

    assert config.ca_bundle is None


def test_send_data_removes_pending_item_after_success(monkeypatch, temp_dir):
    pending, dead = _configure_inventory_queue(monkeypatch, temp_dir)
    config = _make_inventory_config()

    monkeypatch.setattr(agent, "_post_payload", lambda payload, cfg: True)

    assert agent.send_data({"host": "pc-01"}, config) is True
    assert list(pending.glob("*.json")) == []
    assert list(dead.glob("*.json")) == []


def test_send_data_increments_attempts_and_next_attempt_at_on_failure(monkeypatch, temp_dir):
    pending, dead = _configure_inventory_queue(monkeypatch, temp_dir)
    config = _make_inventory_config()

    monkeypatch.setattr(agent.time, "time", lambda: 1000)
    monkeypatch.setattr(agent, "_inventory_backoff_seconds", lambda attempts: 42)
    monkeypatch.setattr(agent, "_post_payload", lambda payload, cfg: False)

    assert agent.send_data({"host": "pc-02"}, config) is False

    queued_files = list(pending.glob("*.json"))
    assert len(queued_files) == 1
    item = json.loads(queued_files[0].read_text(encoding="utf-8"))
    assert item["attempts"] == 1
    assert item["next_attempt_at"] == 1042
    assert item["last_error"] == "NET_TIMEOUT_OR_HTTP_ERROR"
    assert list(dead.glob("*.json")) == []


def test_inventory_queue_prune_moves_corrupt_item_to_dead_letter(monkeypatch, temp_dir):
    pending, dead = _configure_inventory_queue(monkeypatch, temp_dir)
    config = _make_inventory_config()

    bad_path = pending / "0000000001_corrupt.json"
    bad_path.write_text("{not-json", encoding="utf-8")

    agent._inventory_queue_prune_limits(config)

    assert list(pending.glob("*.json")) == []
    dead_files = list(dead.glob("*.json"))
    assert len(dead_files) == 1
    dead_item = json.loads(dead_files[0].read_text(encoding="utf-8"))
    assert dead_item["dropped_reason"] == "QUEUE_CORRUPT"


def test_send_data_moves_invalid_payload_item_to_dead_letter(monkeypatch, temp_dir):
    pending, dead = _configure_inventory_queue(monkeypatch, temp_dir)
    config = _make_inventory_config()
    monkeypatch.setattr(agent.time, "time", lambda: 1000)

    invalid_item = {
        "id": "bad-item",
        "created_at": 1000,
        "payload": ["invalid"],
        "attempts": 0,
        "next_attempt_at": 0,
        "last_error": "",
    }
    (pending / "0000000001_invalid.json").write_text(json.dumps(invalid_item), encoding="utf-8")
    monkeypatch.setattr(agent, "_post_payload", lambda payload, cfg: True)

    assert agent.send_data({"host": "pc-03"}, config) is True

    assert list(pending.glob("*.json")) == []
    dead_files = list(dead.glob("*.json"))
    assert len(dead_files) == 1
    dead_item = json.loads(dead_files[0].read_text(encoding="utf-8"))
    assert dead_item["dropped_reason"] == "QUEUE_INVALID_PAYLOAD"
