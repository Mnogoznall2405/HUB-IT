<#
.SYNOPSIS
  Compares the Python agent payload with the C# agent payload on this machine.

.DESCRIPTION
  Read-only: the C# side runs with --dry-run and an isolated --data-dir, so it
  never sends inventory and never touches the running agent's spool/state.
  The Python side only calls the collector functions; state files are redirected
  into the parity work directory.

.EXAMPLE
  powershell -File agent-dotnet/scripts/parity-check.ps1
  powershell -File agent-dotnet/scripts/parity-check.ps1 -IncludeProfiles
#>
[CmdletBinding()]
param(
    [string]$Python = "",
    [string]$Dotnet = "",
    [switch]$IncludeProfiles
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Python) { $Python = Join-Path $repoRoot '.venv\Scripts\python.exe' }
if (-not $Dotnet) { $Dotnet = Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe' }

$dll = Join-Path $repoRoot 'agent-dotnet\src\Hub.Agent\bin\Release\net8.0-windows\win-x64\ITInventAgent.dll'
if (-not (Test-Path $dll)) {
    throw "Build the solution first: tools\dotnet-sdk-8\dotnet.exe build agent-dotnet\Hub.Agent.sln -c Release"
}

$work = Join-Path $repoRoot 'tmp\agent-parity'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$pyJson = Join-Path $work 'python.json'
$csJson = Join-Path $work 'csharp.json'

$pythonScript = @'
import json, socket, sys
from pathlib import Path
import agent

work = Path(sys.argv[2])
include_profiles = sys.argv[3].lower() == "true"
work.mkdir(parents=True, exist_ok=True)
agent.USER_PROFILE_SIZES_CACHE_PATH = work / "user_profile_sizes_cache.json"
agent.OUTLOOK_SCAN_STATE_PATH = work / "outlook_scan_state.json"

user = agent.get_active_console_user()
out = {
  "hostname": socket.gethostname(),
  "mac_address": agent.get_mac_address(),
  "system_serial": agent.get_system_serial(),
  "cpu_model": agent.get_cpu_model(),
  "os_info": agent.get_os_info(),
  "monitors": agent.get_monitors(),
  "logical_disks": agent.get_logical_disks(),
  "storage": agent.get_storage_info(),
  "network": agent.get_network_info(),
  "security": agent.get_security_info(),
  "updates": agent.get_updates_info(),
  "usb_devices": agent.collect_usb_devices(),
  "software_count": len(agent._iter_uninstall_software_items()),
  "outlook": agent.collect_outlook_info(user, force_refresh=True),
}
if include_profiles:
    out["user_profile_sizes"] = agent.collect_user_profile_sizes(allow_scan=True, force_refresh=True)
open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, default=str))
'@

Push-Location $repoRoot
try {
    $includeProfilesArg = if ($IncludeProfiles) { 'true' } else { 'false' }
    $pythonScript | & $Python - $pyJson $work $includeProfilesArg
    if ($LASTEXITCODE -ne 0) { throw "Python collector failed with exit code $LASTEXITCODE" }

    $csArgs = @($dll, '--dry-run', '--force-software', '--data-dir', (Join-Path $work 'data'), '--out', $csJson)
    if (-not $IncludeProfiles) { $csArgs += '--skip-profiles' }
    & $Dotnet @csArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "C# agent failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}

$compareScript = @'
import json, sys

cs = json.load(open(sys.argv[1], encoding="utf-8"))
py = json.load(open(sys.argv[2], encoding="utf-8"))
failures = 0

def check(name, left, right):
    global failures
    ok = left == right
    if not ok:
        failures += 1
    print(f"{'OK  ' if ok else 'DIFF'} {name}: cs={left!r} py={right!r}")

check("hostname", cs["hostname"], py["hostname"])
check("mac_address", cs["mac_address"], py["mac_address"])
check("system_serial", cs["system_serial"], py["system_serial"])
check("cpu_model", cs["cpu_model"], py["cpu_model"])
for field in ("caption", "build_number", "install_date"):
    check(f"os_info.{field}", cs["os_info"].get(field), py["os_info"].get(field))
check("monitors.count", len(cs["monitors"]), len(py["monitors"]))
check("logical_disks.count", len(cs["logical_disks"]), len(py["logical_disks"]))
check("storage.count", len(cs["storage"]), len(py["storage"]))
check("network.devices.count", len(cs["network"]["devices"]), len(py["network"]["devices"]))
check("network.summary", cs["network"]["summary"], py["network"]["summary"])
check("network.default_gateway", cs["network"]["default_gateway"], py["network"]["default_gateway"])
check("network.dns_servers", sorted(cs["network"]["dns_servers"]), sorted(py["network"]["dns_servers"]))
check("security.keys", sorted(cs["security"]), sorted(py["security"]))
check("security.firewall", cs["security"].get("firewall"), py["security"].get("firewall"))
check("security.tpm", cs["security"].get("tpm"), py["security"].get("tpm"))
check("security.rdp_enabled", cs["security"].get("rdp_enabled"), py["security"].get("rdp_enabled"))
check("security.secure_boot", cs["security"].get("secure_boot"), py["security"].get("secure_boot"))
check("updates", cs.get("updates"), py.get("updates"))
check("usb_devices.count", cs.get("usb_devices", {}).get("count"), py["usb_devices"].get("count"))
check("software.count", cs.get("software_inventory", {}).get("count"), py["software_count"])

for field in ("source", "confidence", "status", "active_store", "largest_file_path",
              "largest_file_size_bytes", "total_outlook_size_bytes"):
    check(f"outlook.{field}", cs["outlook"].get(field), py["outlook"].get(field))
check("outlook.archives", len(cs["outlook"]["archives"]), len(py["outlook"]["archives"]))

if "user_profile_sizes" in py:
    left = cs["user_profile_sizes"]
    right = py["user_profile_sizes"]
    check("profiles.count", left["profiles_count"], right["profiles_count"])
    check("profiles.partial", left["partial"], right["partial"])
    check("profiles.limits", left["limits"], right["limits"])
    left_size = left["total_size_bytes"]
    right_size = right["total_size_bytes"]
    drift = abs(left_size - right_size) / max(1, right_size)
    ok = drift <= 0.05
    if not ok:
        failures += 1
    print(f"{'OK  ' if ok else 'DIFF'} profiles.total_size drift={drift:.2%} (cs={left_size} py={right_size})")

print()
print("PASS" if failures == 0 else f"FAIL ({failures} mismatch)")
sys.exit(0 if failures == 0 else 1)
'@

$compareScript | & $Python - $csJson $pyJson
exit $LASTEXITCODE
