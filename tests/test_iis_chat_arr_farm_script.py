from __future__ import annotations

from pathlib import Path


def _source() -> str:
    root = Path(__file__).resolve().parents[1]
    return (root / "scripts" / "iis" / "configure-chat-arr-farm.ps1").read_text(
        encoding="utf-8"
    )


def test_arr_script_is_validate_only_by_default_and_never_edits_web_config():
    source = _source()

    assert "'Validate', 'Enable', 'Rollback'" in source
    assert "[string]$Mode = 'Validate'" in source
    assert "public/web.config" not in source.lower()
    assert "Set-Content" not in source
    assert "Copy-Item" not in source
    assert "does not touch" in source.lower()
    assert "Validation passed. IIS applicationHost.config was not changed." in source


def test_arr_script_checks_both_fail_closed_nodes_before_backup_or_mutation():
    source = _source()

    primary = "Wait-PostgresChatReady -Url $primaryReadyUrl"
    secondary = "Wait-PostgresChatReady -Url $secondaryReadyUrl"
    backup = "Add-IisBackup -Name $createdBackupName"

    assert "http://127.0.0.1:8002/health/ready" in source
    assert "http://localhost:8004/health/ready" in source
    assert "realtime_transport -eq 'postgres'" in source
    assert "realtime_available -eq $true" in source
    assert "realtime_subscriber_ready -eq $true" in source
    assert source.index(primary) < source.index(secondary) < source.index(backup)


def test_arr_farm_has_expected_members_health_and_websocket_settings():
    source = _source()

    assert "[string]$FarmName = 'itinvent-chat'" in source
    assert "[address='127.0.0.1']" in source
    assert "applicationRequestRouting.httpPort:8002" in source
    assert "[address='localhost']" in source
    assert "applicationRequestRouting.httpPort:8004" in source
    assert '"http://$FarmName/health/ready"' in source
    assert "healthCheck.statusCodeMatch:200" in source
    assert "healthCheck.fastFailure:True" in source

    assert "loadBalancing.algorithm:WeightedRoundRobin" in source
    assert "affinity.useCookie:False" in source
    assert "affinity.useHostName:False" in source
    assert "affinity.useExternalCache:False" in source
    assert "protocol.cache.enabled:False" in source

    assert "protocol.httpVersion:Http11" in source
    assert "protocol.keepAlive:True" in source
    assert "protocol.timeout:01:00:00" in source
    assert "protocol.bufferChunkedResponses:False" in source


def test_arr_enable_has_applicationhost_backup_and_automatic_restore():
    source = _source()

    assert "'add', 'backup', $Name" in source
    assert "'restore', 'backup', $Name" in source
    assert "Rollback requires -BackupName" in source
    assert "Restore-IisBackup -Name $createdBackupName" in source
    assert "throw $failure" in source
    assert "-section:webFarms" in source
    assert "/commit:apphost" in source
